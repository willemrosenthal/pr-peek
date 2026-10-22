import {
  channels,
  prSnapshot,
  ruleOptions,
  rules,
  severity,
  type Channel,
  type DetectedItem,
  type PrSnapshot,
  type Rule,
  type RuleContext,
  type RuleOptions,
  type Severity,
} from "@pr-peek/core";
import type { Octokit } from "octokit";
import type { Db } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { fetchViewerTeams } from "./github/teams";

// Postgres NOTIFY channel. The payload is the user id. Plan 06 listens for SSE.
export const ITEMS_CHANNEL = "user_items_changed";

// For transactions that save items. Waits for a free connection longer than Prisma's
// 2 seconds, since the worker's syncs share the pool.
export const ITEMS_TX = { timeout: 30_000, maxWait: 10_000 };

type Tx = Prisma.TransactionClient;

// Holds the user's items until the transaction ends, so the worker's sync and a re-run
// from the web service never save the same user's items at once.
export async function lockUserItems(tx: Tx, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
}

// Tells listeners the user's items changed. Sent when the transaction commits.
export async function publishItemsChanged(
  tx: Tx,
  userId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_notify(${ITEMS_CHANNEL}, ${userId})`;
}

export interface EffectiveRuleSetting {
  rule: Rule;
  enabled: boolean;
  severity: Severity;
  channels: Channel[];
  options: RuleOptions;
}

// Each rule with the user's setting, or the rule's defaults if they have none.
export async function loadRuleSettings(
  db: Db,
  userId: string,
): Promise<EffectiveRuleSetting[]> {
  const rows = await db.ruleSetting.findMany({ where: { userId } });
  const byId = new Map(rows.map((row) => [row.ruleId, row]));
  return rules.map((rule) => {
    const row = byId.get(rule.id);
    // Missing or unknown values fall back to the rule's defaults.
    return {
      rule,
      enabled: row?.enabled ?? true,
      severity: severity.catch(rule.defaultSeverity).parse(row?.severity),
      channels: channels.catch(rule.defaultChannels).parse(row?.channels),
      options: ruleOptions.catch({}).parse(row?.options ?? {}),
    };
  });
}

// Rule setting rows for a new user, from each rule's defaults.
export const defaultRuleSettings = () =>
  rules.map((rule) => ({
    ruleId: rule.id,
    severity: rule.defaultSeverity,
    channels: rule.defaultChannels,
  }));

// "Include drafts" is set on the review requested rule and applies to re-requests too.
export const includeDraftsFrom = (settings: EffectiveRuleSetting[]) =>
  settings.find((s) => s.rule.id === "review_requested")?.options
    .includeDrafts ?? false;

// Every item the user's enabled rules find on one PR.
export const detectItems = (
  settings: EffectiveRuleSetting[],
  snapshot: PrSnapshot,
  ctx: RuleContext,
): DetectedItem[] =>
  settings
    .filter((s) => s.enabled)
    .flatMap((s) => s.rule.detect(snapshot, ctx));

// The user's enabled rules, ready to run on these PRs. Asks GitHub for the user's teams
// only when a team is asked to review one of them.
export async function prepareRules(
  db: Db,
  userId: string,
  snapshots: PrSnapshot[],
  now: Date,
  github: () => Promise<Octokit>,
): Promise<(snapshot: PrSnapshot) => DetectedItem[]> {
  const [user, settings, ruleSettings] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { login: true },
    }),
    db.userSettings.findUnique({
      where: { userId },
      select: { includeTeamRequests: true, hideBots: true },
    }),
    loadRuleSettings(db, userId),
  ]);
  const includeTeamRequests = settings?.includeTeamRequests ?? true;
  const hasTeamRequest = snapshots.some((snapshot) =>
    snapshot.reviewRequests.some((reviewer) => reviewer.type === "team"),
  );
  const viewerTeams =
    includeTeamRequests && hasTeamRequest
      ? await fetchViewerTeams(await github(), user.login)
      : [];
  const ctx: RuleContext = {
    viewerLogin: user.login,
    viewerTeams,
    now,
    settings: {
      includeTeamRequests,
      hideBots: settings?.hideBots ?? false,
      includeDrafts: includeDraftsFrom(ruleSettings),
    },
  };
  return (snapshot) => detectItems(ruleSettings, snapshot, ctx);
}

export interface SavedPr {
  // The PullRequest row id.
  id: string;
  snapshot: PrSnapshot;
}

// Saves the items each PR has now and resolves the ones it no longer has.
// Returns the ids of items that are new or have a new event, for notifications.
export async function saveItems(
  tx: Tx,
  userId: string,
  prs: SavedPr[],
  detect: (snapshot: PrSnapshot) => DetectedItem[],
  now: Date,
): Promise<string[]> {
  const before = await tx.item.findMany({
    where: { userId, pullRequestId: { in: prs.map((pr) => pr.id) } },
    select: { dedupeKey: true, latestEventId: true },
  });
  const eventBefore = new Map(
    before.map((item) => [item.dedupeKey, item.latestEventId]),
  );

  const newEventIds: string[] = [];
  for (const pr of prs) {
    const items = detect(pr.snapshot);
    for (const item of items) {
      const isNewEvent = eventBefore.get(item.dedupeKey) !== item.latestEventId;
      const fields = {
        kind: item.kind,
        latestEventId: item.latestEventId,
        eventCount: item.eventCount,
        actorLogin: item.actorLogin,
        summary: item.summary,
        occurredAt: new Date(item.occurredAt),
        waitingSince: item.waitingSince && new Date(item.waitingSince),
        // Reopens an item that was resolved before.
        status: "open" as const,
        resolvedAt: null,
      };
      const saved = await tx.item.upsert({
        where: { userId_dedupeKey: { userId, dedupeKey: item.dedupeKey } },
        create: {
          userId,
          pullRequestId: pr.id,
          dedupeKey: item.dedupeKey,
          ...fields,
        },
        // Something new happened, so the user hasn't seen it yet.
        update: { ...fields, ...(isNewEvent && { seenAt: null }) },
        select: { id: true },
      });
      if (isNewEvent) newEventIds.push(saved.id);
    }

    await tx.item.updateMany({
      where: {
        userId,
        pullRequestId: pr.id,
        status: "open",
        dedupeKey: { notIn: items.map((item) => item.dedupeKey) },
      },
      data: { status: "resolved", resolvedAt: now },
    });
  }
  return newEventIds;
}

// Resolves the open items on the PRs with these GitHub ids. Returns how many.
export async function resolveItemsOf(
  tx: Tx,
  userId: string,
  githubNodeIds: string[],
  now: Date,
): Promise<number> {
  if (githubNodeIds.length === 0) return 0;
  const { count } = await tx.item.updateMany({
    where: {
      userId,
      status: "open",
      pullRequest: { githubNodeId: { in: githubNodeIds } },
    },
    data: { status: "resolved", resolvedAt: now },
  });
  return count;
}

// The PRs the sync tracks. Ended ones already had their items resolved.
async function trackedPrs(tx: Tx, userId: string): Promise<SavedPr[]> {
  const rows = await tx.pullRequest.findMany({
    where: { userId, state: "open" },
    select: { id: true, snapshot: true },
  });
  return rows.flatMap((row): SavedPr[] => {
    const parsed = prSnapshot.safeParse(row.snapshot);
    return parsed.success ? [{ id: row.id, snapshot: parsed.data }] : [];
  });
}

// Runs the rules again after the user changes a setting that affects them. Uses the
// stored snapshots, so it only calls GitHub for the user's teams. Doesn't notify: a
// settings change isn't something new on GitHub.
export async function rerunRules(
  db: Db,
  userId: string,
  github: () => Promise<Octokit>,
  now = new Date(),
): Promise<void> {
  // Read first only to prepare the rules, so GitHub isn't called inside the transaction.
  const before = await trackedPrs(db, userId);
  if (before.length === 0) return;
  const detect = await prepareRules(
    db,
    userId,
    before.map((pr) => pr.snapshot),
    now,
    github,
  );

  await db.$transaction(async (tx) => {
    await lockUserItems(tx, userId);
    // Read again under the lock, in case a sync saved newer snapshots meanwhile.
    const prs = await trackedPrs(tx, userId);
    await saveItems(tx, userId, prs, detect, now);
    await publishItemsChanged(tx, userId);
  }, ITEMS_TX);
}
