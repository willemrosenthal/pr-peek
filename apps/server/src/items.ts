import {
  rules,
  type Channel,
  type DetectedItem,
  type PrSnapshot,
  type Rule,
  type RuleContext,
  type Severity,
} from "@pr-peek/core";
import { z } from "zod";
import type { Db } from "./db";
import type { Prisma } from "./generated/prisma/client";

// Postgres NOTIFY channel. The payload is the user id. Plan 06 listens for SSE.
export const ITEMS_CHANNEL = "user_items_changed";

const severity = z.enum(["low", "normal", "high"]);
const channels = z.array(z.enum(["list", "push"]));

// Options a rule setting can hold. Only the review request rules use one so far.
const ruleOptions = z
  .object({ includeDrafts: z.boolean() })
  .partial()
  .catch({});

export interface EffectiveRuleSetting {
  rule: Rule;
  enabled: boolean;
  severity: Severity;
  channels: Channel[];
  options: z.infer<typeof ruleOptions>;
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
      options: ruleOptions.parse(row?.options ?? {}),
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

export interface SavedPr {
  // The PullRequest row id.
  id: string;
  snapshot: PrSnapshot;
}

// Saves the items each PR has now and resolves the ones it no longer has.
// Returns the ids of items that are new or have a new event, for notifications.
export async function saveItems(
  tx: Prisma.TransactionClient,
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

// Resolves open items on PRs this sync didn't find: merged, closed, or no longer involving
// the user. Run after every found PR's `lastSeenAt` is set to `now`. Returns how many.
export async function resolveUnseenItems(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<number> {
  const { count } = await tx.item.updateMany({
    where: {
      userId,
      status: "open",
      pullRequest: { lastSeenAt: { lt: now } },
    },
    data: { status: "resolved", resolvedAt: now },
  });
  return count;
}
