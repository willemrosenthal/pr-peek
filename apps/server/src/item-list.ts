import {
  byUrgency,
  formatAge,
  ITEM_GROUPS,
  SEVERITY_RANK,
  staleLevel,
  waitingFor,
  type IdlePrDto,
  type ItemDto,
  type ItemGroups,
  type ItemKind,
  type SummaryResponse,
} from "@pr-peek/core";
import type { Db } from "./db";
import type { PullRequest } from "./generated/prisma/client";
import { loadRuleSettings } from "./items";

const isItemKind = (kind: string): kind is ItemKind =>
  Object.hasOwn(ITEM_GROUPS, kind);

const PR_FIELDS = {
  githubRepoId: true,
  title: true,
  repoOwner: true,
  repoName: true,
  number: true,
  url: true,
} as const;

type PrRow = Pick<PullRequest, keyof typeof PR_FIELDS>;

// Each watched repo's color, by GitHub repo id. Repos with no color are left out.
async function repoColors(
  db: Db,
  userId: string,
): Promise<Map<number, string>> {
  const repos = await db.watchedRepo.findMany({
    where: { userId, color: { not: null } },
    select: { githubRepoId: true, color: true },
  });
  return new Map(repos.map((repo) => [repo.githubRepoId, repo.color!]));
}

const toPrDto = (pr: PrRow, colors: Map<number, string>): ItemDto["pr"] => ({
  title: pr.title,
  owner: pr.repoOwner,
  repo: pr.repoName,
  number: pr.number,
  url: pr.url,
  color: colors.get(pr.githubRepoId) ?? null,
});

// The user's open items, most urgent first.
export async function openItems(
  db: Db,
  userId: string,
  now: Date,
): Promise<ItemDto[]> {
  const [items, settings, ruleSettings, colors] = await Promise.all([
    db.item.findMany({
      where: { userId, status: "open" },
      include: { pullRequest: { select: PR_FIELDS } },
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
    repoColors(db, userId),
  ]);
  const severityOf = new Map(ruleSettings.map((s) => [s.rule.id, s.severity]));

  return items
    .flatMap((item): ItemDto[] => {
      // Skips kinds from rules that no longer exist.
      if (!isItemKind(item.kind)) return [];
      return [
        {
          id: item.id,
          kind: item.kind,
          summary: item.summary,
          actorLogin: item.actorLogin,
          actorIsBot: item.actorIsBot,
          occurredAt: item.occurredAt.toISOString(),
          waitingSince: item.waitingSince?.toISOString() ?? null,
          age: formatAge(item.waitingSince ?? item.occurredAt, now),
          staleLevel: item.waitingSince
            ? staleLevel(waitingFor(item.waitingSince, now, settings), settings)
            : null,
          severity: severityOf.get(item.kind) ?? "normal",
          unseen: item.seenAt === null,
          otherIds: [],
          pr: toPrDto(item.pullRequest, colors),
        },
      ];
    })
    .sort(byUrgency(settings, now));
}

// Picks the item a PR's row shows when its items have the same severity. Lower first.
// A record, so a new kind can't be left out.
const KIND_RANK: Record<ItemKind, number> = {
  re_requested: 0,
  review_requested: 1,
  check_failed: 2,
  reviewed: 3,
  reply: 4,
  mention: 5,
  commented: 6,
};

const byRowRank = (a: ItemDto, b: ItemDto) =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
  KIND_RANK[a.kind] - KIND_RANK[b.kind];

// One row per PR, from items sorted most urgent first. Each row shows the PR's highest
// severity item, then the first by `KIND_RANK`. Not the urgency score, which adds points
// for unseen items, so the row would switch kinds once seen. Rows keep the place of the
// PR's most urgent item.
export function onePerPr(items: ItemDto[]): ItemDto[] {
  const byPr = new Map<string, ItemDto[]>();
  for (const item of items) {
    const prItems = byPr.get(item.pr.url);
    if (prItems) prItems.push(item);
    else byPr.set(item.pr.url, [item]);
  }
  return [...byPr.values()].map((prItems) => {
    const [top, ...others] = prItems.toSorted(byRowRank);
    return {
      ...top!,
      unseen: prItems.some((item) => item.unseen),
      otherIds: others.map((item) => item.id),
    };
  });
}

// The user's open PRs that have no open items, newest change first.
export async function idlePrs(
  db: Db,
  user: { id: string; login: string },
  now: Date,
): Promise<IdlePrDto[]> {
  const [rows, colors] = await Promise.all([
    db.pullRequest.findMany({
      where: {
        userId: user.id,
        state: "open",
        authorLogin: { equals: user.login, mode: "insensitive" },
        items: { none: { status: "open" } },
      },
      orderBy: { githubUpdatedAt: "desc" },
    }),
    repoColors(db, user.id),
  ]);
  return rows.map((row) => ({
    id: row.id,
    isDraft: row.isDraft,
    age: formatAge(row.githubUpdatedAt, now),
    pr: toPrDto(row, colors),
  }));
}

// Splits sorted items into the list's sections, one row per PR, keeping their order.
export function groupItems(items: ItemDto[]): ItemGroups {
  const groups: ItemGroups = { review: [], replies: [], mine: [] };
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
