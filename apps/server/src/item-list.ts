import {
  byUrgency,
  formatAge,
  ITEM_GROUPS,
  staleLevel,
  waitingFor,
  type ItemDto,
  type ItemKind,
  type ItemsResponse,
  type SummaryResponse,
} from "@pr-peek/core";
import type { Db } from "./db";
import { loadRuleSettings } from "./items";

const isItemKind = (kind: string): kind is ItemKind => kind in ITEM_GROUPS;

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

// Splits sorted items into the list's sections, keeping their order.
export function groupItems(items: ItemDto[]): ItemsResponse {
  const groups: ItemsResponse = { review: [], replies: [], mine: [] };
  for (const item of items) groups[ITEM_GROUPS[item.kind]].push(item);
  return groups;
}

export function summarize(items: ItemDto[]): SummaryResponse {
  const groups = groupItems(items);
  return {
    total: items.length,
    review: groups.review.length,
    replies: groups.replies.length,
    mine: groups.mine.length,
    hasStale: items.some(
      (item) => item.staleLevel !== null && item.staleLevel !== "fresh",
    ),
    hasFailing: items.some((item) => item.kind === "check_failed"),
  };
}
