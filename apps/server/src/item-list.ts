import {
  assignedState,
  byUrgency,
  formatAge,
  ITEM_GROUPS,
  itemStaleLevel,
  prSnapshot,
  SEVERITY_RANK,
  type AssignedState,
  type IdlePrDto,
  type ItemDto,
  type ItemGroup,
  type ItemGroups,
  type ItemKind,
  type MergedPrDto,
  type SummaryResponse,
} from "@pr-peek/core";
import type { Db } from "./db";
import type { PullRequest } from "./generated/prisma/client";
import { loadRuleSettings } from "./items";

const isItemKind = (kind: string): kind is ItemKind =>
  Object.hasOwn(ITEM_GROUPS, kind);

const PR_FIELDS = {
  id: true,
  githubRepoId: true,
  title: true,
  repoOwner: true,
  repoName: true,
  number: true,
  url: true,
  authorLogin: true,
  importantAt: true,
} as const;

type PrRow = Pick<PullRequest, keyof typeof PR_FIELDS>;

// Each watched repo's color, by GitHub repo id. Repos with color off are left out.
async function repoColors(
  db: Db,
  userId: string,
): Promise<Map<number, string>> {
  const repos = await db.watchedRepo.findMany({
    where: { userId, colorOn: true, color: { not: null } },
    select: { githubRepoId: true, color: true },
  });
  return new Map(repos.map((repo) => [repo.githubRepoId, repo.color!]));
}

const toPrDto = (pr: PrRow, colors: Map<number, string>): ItemDto["pr"] => ({
  id: pr.id,
  title: pr.title,
  owner: pr.repoOwner,
  repo: pr.repoName,
  number: pr.number,
  url: pr.url,
  author: pr.authorLogin,
  color: colors.get(pr.githubRepoId) ?? null,
  important: pr.importantAt !== null,
});

// What each PR needs next, by PR id, from the stored snapshots. Read separately, and
// only for assigned items, since snapshots are large.
async function assignedStates(
  db: Db,
  prIds: string[],
): Promise<Map<string, AssignedState>> {
  if (prIds.length === 0) return new Map();
  const rows = await db.pullRequest.findMany({
    where: { id: { in: prIds } },
    select: { id: true, snapshot: true },
  });
  return new Map(
    rows.flatMap((row): [string, AssignedState][] => {
      const parsed = prSnapshot.safeParse(row.snapshot);
      return parsed.success ? [[row.id, assignedState(parsed.data)]] : [];
    }),
  );
}

// Matches PRs the user quieted, or the rest.
const quietWhere = (quiet: boolean) => ({
  quietAt: quiet ? { not: null } : null,
});

// The user's open items, most urgent first. Only those on quiet PRs when `quiet`.
export async function openItems(
  db: Db,
  userId: string,
  now: Date,
  quiet = false,
): Promise<ItemDto[]> {
  const [items, settings, ruleSettings, colors] = await Promise.all([
    db.item.findMany({
      where: { userId, status: "open", pullRequest: quietWhere(quiet) },
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
  const assignedPrIds = new Set(
    items
      .filter((item) => item.kind === "assigned")
      .map((item) => item.pullRequestId),
  );
  const states = await assignedStates(db, [...assignedPrIds]);

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
          waitingOnAuthor: item.waitingOnAuthor,
          staleLevel: itemStaleLevel(
            { kind: item.kind, waitingSince: item.waitingSince },
            now,
            settings,
          ),
          assignedState:
            item.kind === "assigned"
              ? (states.get(item.pullRequestId) ?? "waiting_on_review")
              : null,
          assigned: assignedPrIds.has(item.pullRequestId),
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
  // After review requests, so a PR you're asked to review stays in that section.
  assigned: 4,
  reply: 5,
  mention: 6,
  commented: 7,
};

const byRowRank = (a: ItemDto, b: ItemDto) =>
  Number(a.waitingOnAuthor) - Number(b.waitingOnAuthor) ||
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
  KIND_RANK[a.kind] - KIND_RANK[b.kind];

// One row per PR, from items sorted most urgent first. Each row shows the PR's highest
// severity item, then the first by `KIND_RANK`. Not the urgency score, which adds points
// for unseen items, so the row would switch kinds once seen. Rows keep the place of the
// PR's most urgent item. Items waiting on the author come last.
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

// The user's open PRs, and ones they marked important, that have no open items, newest
// change first. Only quiet ones when `quiet`.
export async function idlePrs(
  db: Db,
  user: { id: string; login: string },
  now: Date,
  quiet = false,
): Promise<IdlePrDto[]> {
  const [rows, colors] = await Promise.all([
    db.pullRequest.findMany({
      where: {
        userId: user.id,
        state: "open",
        ...quietWhere(quiet),
        OR: [
          { authorLogin: { equals: user.login, mode: "insensitive" } },
          { importantAt: { not: null } },
        ],
        items: { none: { status: "open" } },
      },
      orderBy: { githubUpdatedAt: "desc" },
    }),
    repoColors(db, user.id),
  ]);
  return rows.map((row) => ({
    id: row.id,
    group: prGroup(row, user.login),
    isDraft: row.isDraft,
    age: formatAge(row.githubUpdatedAt, now),
    pr: toPrDto(row, colors),
  }));
}

// The section a PR with no open items shows in. With no item to go by, it goes by the PR:
// the user's own, or one they're assigned to and not reviewing. Any other goes under
// review.
export function prGroup(
  pr: Pick<PullRequest, "authorLogin" | "snapshot">,
  viewerLogin: string,
): ItemGroup {
  const isViewer = (login: string) =>
    login.toLowerCase() === viewerLogin.toLowerCase();
  if (isViewer(pr.authorLogin)) return "mine";
  const parsed = prSnapshot.safeParse(pr.snapshot);
  if (!parsed.success) return "review";
  const snapshot = parsed.data;
  const reviewing =
    snapshot.reviews.some((review) => isViewer(review.author.login)) ||
    snapshot.reviewRequests.some(
      (reviewer) => reviewer.type === "user" && isViewer(reviewer.login),
    );
  const assigned = snapshot.assignees?.some(isViewer) ?? false;
  return assigned && !reviewing ? "assigned" : "review";
}

// The user's important PRs that merged, newest merge first. Only those in repos the user
// watches now, like open items. A paused repo's come back when it's on again.
export async function mergedPrs(
  db: Db,
  user: { id: string; login: string },
  now: Date,
): Promise<MergedPrDto[]> {
  const [rows, colors, watched] = await Promise.all([
    db.pullRequest.findMany({
      where: { userId: user.id, state: "merged", importantAt: { not: null } },
      orderBy: { mergedAt: "desc" },
    }),
    repoColors(db, user.id),
    db.watchedRepo.findMany({
      where: { userId: user.id, enabled: true },
      select: { githubRepoId: true },
    }),
  ]);
  const watchedIds = new Set(watched.map((repo) => repo.githubRepoId));
  return rows
    .filter((row) => watchedIds.has(row.githubRepoId))
    .map((row) => ({
      id: row.id,
      group: prGroup(row, user.login),
      // Merged before we kept the time. The last change on GitHub is close.
      age: formatAge(row.mergedAt ?? row.githubUpdatedAt, now),
      pr: toPrDto(row, colors),
    }));
}

// Splits sorted items into the list's sections, one row per PR, keeping their order.
export function groupItems(items: ItemDto[]): ItemGroups {
  const groups: ItemGroups = {
    review: [],
    replies: [],
    assigned: [],
    mine: [],
  };
  for (const row of onePerPr(items)) groups[ITEM_GROUPS[row.kind]].push(row);
  return groups;
}

// Counts PRs, like the list, but not those waiting on the author. The flags look at
// every item.
export function summarize(items: ItemDto[]): SummaryResponse {
  const groups = groupItems(items.filter((item) => !item.waitingOnAuthor));
  return {
    total:
      groups.review.length +
      groups.replies.length +
      groups.assigned.length +
      groups.mine.length,
    review: groups.review.length,
    replies: groups.replies.length,
    assigned: groups.assigned.length,
    mine: groups.mine.length,
    // Review requests only. An assigned PR days old shouldn't color the menu bar icon.
    hasStale: items.some(
      (item) =>
        item.kind !== "assigned" &&
        item.staleLevel !== null &&
        item.staleLevel !== "fresh",
    ),
    hasFailing: items.some((item) => item.kind === "check_failed"),
  };
}
