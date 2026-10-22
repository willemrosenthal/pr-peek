import {
  byUrgency,
  formatAge,
  ITEM_GROUPS,
  staleLevel,
  waitingFor,
  type ItemDto,
  type ItemKind,
  type ItemsResponse,
  type Severity,
  type SummaryResponse,
} from "@pr-peek/core";
import type { Db } from "./db";
import { loadRuleSettings } from "./items";

const isItemKind = (kind: string): kind is ItemKind =>
  Object.hasOwn(ITEM_GROUPS, kind);

// The user's open items, most urgent first.
export async function openItems(
  db: Db,
  userId: string,
  now: Date,
): Promise<ItemDto[]> {
  const [items, settings, ruleSettings] = await Promise.all([
    db.item.findMany({
      where: { userId, status: "open" },
      include: {
        pullRequest: {
          select: {
            title: true,
            repoOwner: true,
            repoName: true,
            number: true,
            url: true,
          },
        },
      },
    }),
    db.userSettings.findUniqueOrThrow({
      where: { userId },
      select: {
        timezone: true,
        workHoursOnly: true,
        staleWarnHours: true,
        staleLateHours: true,
      },
    }),
    loadRuleSettings(db, userId),
  ]);
  const severityOf = new Map(ruleSettings.map((s) => [s.rule.id, s.severity]));

  return items
    .flatMap((item): ItemDto[] => {
      // Skips kinds from rules that no longer exist.
      if (!isItemKind(item.kind)) return [];
      const { pullRequest: pr } = item;
      return [
        {
          id: item.id,
          kind: item.kind,
          summary: item.summary,
          actorLogin: item.actorLogin,
          occurredAt: item.occurredAt.toISOString(),
          waitingSince: item.waitingSince?.toISOString() ?? null,
          age: formatAge(item.waitingSince ?? item.occurredAt, now),
          staleLevel: item.waitingSince
            ? staleLevel(waitingFor(item.waitingSince, now, settings), settings)
            : null,
          severity: severityOf.get(item.kind) ?? "normal",
          unseen: item.seenAt === null,
          otherIds: [],
          pr: {
            title: pr.title,
            owner: pr.repoOwner,
            repo: pr.repoName,
            number: pr.number,
            url: pr.url,
          },
        },
      ];
    })
    .sort(byUrgency(settings, now));
}

// Picks the item a PR's row shows when its items have the same severity.
const KIND_ORDER: ItemKind[] = [
  "re_requested",
  "review_requested",
  "check_failed",
  "reviewed",
  "reply",
  "mention",
  "commented",
];
const SEVERITY_ORDER: Severity[] = ["high", "normal", "low"];

const rowRank = (item: ItemDto) =>
  SEVERITY_ORDER.indexOf(item.severity) * KIND_ORDER.length +
  KIND_ORDER.indexOf(item.kind);

// One row per PR, from items sorted most urgent first. Each row shows the PR's highest
// severity item, then the first in `KIND_ORDER`. Not the urgency score, which adds points
// for unseen items, so the row would switch kinds once seen. Rows keep the place of the
// PR's most urgent item.
export function onePerPr(items: ItemDto[]): ItemDto[] {
  const byPr = new Map<string, ItemDto[]>();
  for (const item of items) {
    byPr.set(item.pr.url, [...(byPr.get(item.pr.url) ?? []), item]);
  }
  return [...byPr.values()].map((prItems) => {
    const [top, ...others] = prItems.toSorted(
      (a, b) => rowRank(a) - rowRank(b),
    );
    return {
      ...top!,
      unseen: prItems.some((item) => item.unseen),
      otherIds: others.map((item) => item.id),
    };
  });
}

// Splits sorted items into the list's sections, one row per PR, keeping their order.
export function groupItems(items: ItemDto[]): ItemsResponse {
  const groups: ItemsResponse = { review: [], replies: [], mine: [] };
  for (const row of onePerPr(items)) groups[ITEM_GROUPS[row.kind]].push(row);
  return groups;
}

// Counts PRs, like the list. The flags look at every item.
export function summarize(items: ItemDto[]): SummaryResponse {
  const groups = groupItems(items);
  return {
    total: groups.review.length + groups.replies.length + groups.mine.length,
    review: groups.review.length,
    replies: groups.replies.length,
    mine: groups.mine.length,
    hasStale: items.some(
      (item) => item.staleLevel !== null && item.staleLevel !== "fresh",
    ),
    hasFailing: items.some((item) => item.kind === "check_failed"),
  };
}
