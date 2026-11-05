import {
  ASSIGNED_STATES,
  byUrgency,
  formatAge,
  ITEM_GROUPS,
  itemStaleLevel,
  SEVERITY_RANK,
  type AssignedState,
  type IdlePrDto,
  type ItemDto,
  type ItemGroups,
  type ItemKind,
  type ListSection,
  type MergedPrDto,
  type PrSnapshot,
  type Severity,
  type SummaryResponse,
} from "@pr-peek/core";
import type { Db } from "./db";
import type { PullRequest, UserSettings } from "./generated/prisma/client";
import { loadRuleSettings } from "./items";

const isItemKind = (kind: string): kind is ItemKind =>
  Object.hasOwn(ITEM_GROUPS, kind);

const isAssignedState = (state: string | null): state is AssignedState =>
  (ASSIGNED_STATES as readonly (string | null)[]).includes(state);

const LIST_SECTIONS = new Set<string | null>([
  ...Object.values(ITEM_GROUPS),
  "watching",
]);
const isListSection = (group: string | null): group is ListSection =>
  LIST_SECTIONS.has(group);

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

// What every part of the list needs from the user, loaded once per list.
export interface ListContext {
  settings: Pick<
    UserSettings,
    "timezone" | "workHoursOnly" | "staleWarnHours" | "staleLateHours"
  >;
  severityOf: Map<string, Severity>;
  // Each watched repo's color, by GitHub repo id. Repos with color off are left out.
  colors: Map<number, string>;
}

export async function loadListContext(
  db: Db,
  userId: string,
): Promise<ListContext> {
  const [settings, ruleSettings, repos] = await Promise.all([
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
    db.watchedRepo.findMany({
      where: { userId, colorOn: true, color: { not: null } },
      select: { githubRepoId: true, color: true },
    }),
  ]);
  return {
    settings,
    severityOf: new Map(ruleSettings.map((s) => [s.rule.id, s.severity])),
    colors: new Map(repos.map((repo) => [repo.githubRepoId, repo.color!])),
  };
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

// Matches PRs the user quieted, or the rest.
const quietWhere = (quiet: boolean) => ({
  quietAt: quiet ? { not: null } : null,
});

interface OpenItemsOptions {
  // Only items on quiet PRs.
  quiet?: boolean;
  // Loaded here if not passed.
  ctx?: ListContext;
}

// The user's open items, most urgent first.
export async function openItems(
  db: Db,
  userId: string,
  now: Date,
  { quiet = false, ctx }: OpenItemsOptions = {},
): Promise<ItemDto[]> {
  const [items, { settings, severityOf, colors }] = await Promise.all([
    db.item.findMany({
      where: { userId, status: "open", pullRequest: quietWhere(quiet) },
      include: {
        pullRequest: { select: { ...PR_FIELDS, assignedState: true } },
      },
    }),
    ctx ?? loadListContext(db, userId),
  ]);
  const assignedPrIds = new Set(
    items
      .filter((item) => item.kind === "assigned")
      .map((item) => item.pullRequestId),
  );

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
              ? isAssignedState(item.pullRequest.assignedState)
                ? item.pullRequest.assignedState
                : "waiting_on_review"
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
  ctx: ListContext,
  quiet = false,
): Promise<IdlePrDto[]> {
  const rows = await db.pullRequest.findMany({
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
    select: {
      ...PR_FIELDS,
      listGroup: true,
      isDraft: true,
      githubUpdatedAt: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    group: prGroup(row, user.login),
    isDraft: row.isDraft,
    age: formatAge(row.githubUpdatedAt, now),
    pr: toPrDto(row, ctx.colors),
  }));
}

// The section a PR with no open items shows in. With no item to go by, it goes by the PR:
// the user's own, one they're reviewing, or one they're assigned to. Any other, like a
// flagged PR the user only follows, goes under Watching.
export function idleGroup(
  snapshot: PrSnapshot,
  viewerLogin: string,
): ListSection {
  const isViewer = (login: string) =>
    login.toLowerCase() === viewerLogin.toLowerCase();
  if (isViewer(snapshot.author.login)) return "mine";
  const reviewing =
    snapshot.reviews.some((review) => isViewer(review.author.login)) ||
    snapshot.reviewRequests.some(
      (reviewer) => reviewer.type === "user" && isViewer(reviewer.login),
    );
  if (reviewing) return "review";
  const assigned = snapshot.assignees?.some(isViewer) ?? false;
  return assigned ? "assigned" : "watching";
}

// The section the sync stored. A row from before it was stored goes by its author.
function prGroup(
  pr: Pick<PullRequest, "authorLogin" | "listGroup">,
  viewerLogin: string,
): ListSection {
  if (isListSection(pr.listGroup)) return pr.listGroup;
  return pr.authorLogin.toLowerCase() === viewerLogin.toLowerCase()
    ? "mine"
    : "watching";
}

// The user's important PRs that merged, newest merge first. Only those in repos the user
// watches now, like open items, or added by their link. A paused repo's come back when
// it's on again.
export async function mergedPrs(
  db: Db,
  user: { id: string; login: string },
  now: Date,
  ctx: ListContext,
): Promise<MergedPrDto[]> {
  const [rows, watched] = await Promise.all([
    db.pullRequest.findMany({
      where: { userId: user.id, state: "merged", importantAt: { not: null } },
      orderBy: { mergedAt: "desc" },
      select: {
        ...PR_FIELDS,
        listGroup: true,
        mergedAt: true,
        githubUpdatedAt: true,
        addedAt: true,
      },
    }),
    db.watchedRepo.findMany({
      where: { userId: user.id, enabled: true },
      select: { githubRepoId: true },
    }),
  ]);
  const watchedIds = new Set(watched.map((repo) => repo.githubRepoId));
  return rows
    .filter((row) => row.addedAt || watchedIds.has(row.githubRepoId))
    .map((row) => ({
      id: row.id,
      group: prGroup(row, user.login),
      // Merged before we kept the time. The last change on GitHub is close.
      age: formatAge(row.mergedAt ?? row.githubUpdatedAt, now),
      pr: toPrDto(row, ctx.colors),
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
