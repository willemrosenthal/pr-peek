import {
  channels,
  prSnapshot,
  ruleOptions,
  rules,
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
import type { Item, Prisma } from "./generated/prisma/client";
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
    // Missing or invalid values fall back to the rule's defaults. The database allows an
    // empty or repeated channel list.
    return {
      rule,
      enabled: row?.enabled ?? true,
      severity: row?.severity ?? rule.defaultSeverity,
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

// How long a user's team list is kept. Joining a team takes up to this long to show.
const TEAMS_KEPT_MS = 60 * 60 * 1000;
const teamsByUser = new Map<string, { teams: string[]; fetchedAt: number }>();

// The user's teams, fetched at most once an hour, since every sync checks every tracked PR.
async function cachedTeams(
  userId: string,
  now: Date,
  fetch: () => Promise<string[]>,
): Promise<string[]> {
  const kept = teamsByUser.get(userId);
  if (kept && now.getTime() - kept.fetchedAt < TEAMS_KEPT_MS) return kept.teams;
  const teams = await fetch();
  teamsByUser.set(userId, { teams, fetchedAt: now.getTime() });
  return teams;
}

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
      ? await cachedTeams(userId, now, async () =>
          fetchViewerTeams(await github(), user.login),
        )
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

export interface SavedItems {
  // Items that are new or have a new event, for notifications.
  newEventIds: string[];
  // Any item was written or resolved.
  changed: boolean;
}

type ItemFields = Pick<
  Item,
  | "kind"
  | "latestEventId"
  | "eventCount"
  | "actorLogin"
  | "actorIsBot"
  | "summary"
  | "occurredAt"
  | "waitingSince"
>;

const sameTime = (a: Date | null, b: Date | null) =>
  a?.getTime() === b?.getTime();

// True if the stored item is open and already has these fields.
const isUnchanged = (stored: Item, fields: ItemFields) =>
  stored.status === "open" &&
  stored.kind === fields.kind &&
  stored.latestEventId === fields.latestEventId &&
  stored.eventCount === fields.eventCount &&
  stored.actorLogin === fields.actorLogin &&
  stored.actorIsBot === fields.actorIsBot &&
  stored.summary === fields.summary &&
  sameTime(stored.occurredAt, fields.occurredAt) &&
  sameTime(stored.waitingSince, fields.waitingSince);

// Saves the items each PR has now and resolves the ones it no longer has. Writes only
// what changed, since every sync runs this for every tracked PR.
export async function saveItems(
  tx: Tx,
  userId: string,
  prs: SavedPr[],
  detect: (snapshot: PrSnapshot) => DetectedItem[],
  now: Date,
): Promise<SavedItems> {
  const before = await tx.item.findMany({
    where: { userId, pullRequestId: { in: prs.map((pr) => pr.id) } },
  });
  const stored = new Map(before.map((item) => [item.dedupeKey, item]));

  const found = new Set<string>();
  const newEventIds: string[] = [];
  let written = 0;
  for (const pr of prs) {
    for (const item of detect(pr.snapshot)) {
      found.add(item.dedupeKey);
      const fields: ItemFields = {
        kind: item.kind,
        latestEventId: item.latestEventId,
        eventCount: item.eventCount,
        actorLogin: item.actorLogin,
        actorIsBot: item.actorIsBot,
        summary: item.summary,
        occurredAt: new Date(item.occurredAt),
        waitingSince: item.waitingSince ? new Date(item.waitingSince) : null,
      };
      const existing = stored.get(item.dedupeKey);
      if (existing && isUnchanged(existing, fields)) continue;

      const isNewEvent = existing?.latestEventId !== item.latestEventId;
      // Reopens an item that was resolved before.
      const update = { ...fields, status: "open" as const, resolvedAt: null };
      const saved = await tx.item.upsert({
        where: { userId_dedupeKey: { userId, dedupeKey: item.dedupeKey } },
        create: {
          userId,
          pullRequestId: pr.id,
          dedupeKey: item.dedupeKey,
          ...update,
        },
        // Something new happened, so the user hasn't seen it yet.
        update: { ...update, ...(isNewEvent && { seenAt: null }) },
        select: { id: true },
      });
      written += 1;
      if (isNewEvent) newEventIds.push(saved.id);
    }
  }

  const goneIds = before
    .filter((item) => item.status === "open" && !found.has(item.dedupeKey))
    .map((item) => item.id);
  if (goneIds.length > 0) {
    await tx.item.updateMany({
      where: { id: { in: goneIds } },
      data: { status: "resolved", resolvedAt: now },
    });
  }

  return { newEventIds, changed: written > 0 || goneIds.length > 0 };
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

// The PRs the sync tracks, from their stored snapshots. Ended ones already had their
// items resolved.
export async function trackedPrs(tx: Tx, userId: string): Promise<SavedPr[]> {
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
    const { changed } = await saveItems(tx, userId, prs, detect, now);
    if (changed) await publishItemsChanged(tx, userId);
  }, ITEMS_TX);
}
