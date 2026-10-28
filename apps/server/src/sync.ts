import type { PrSnapshot } from "@pr-peek/core";
import type { Octokit } from "octokit";
import type { Db } from "./db";
import type { PrState } from "./generated/prisma/client";
import { fetchPrDetails, type PrDetails } from "./github/pull-details";
import {
  fetchPrStatuses,
  findRelevantPrs,
  type PrStatus,
} from "./github/pull-search";
import {
  ITEMS_TX,
  lockUserItems,
  prepareRules,
  publishItemsChanged,
  resolveItemsOf,
  saveItems,
  trackedPrs,
  type SavedPr,
} from "./items";
import { quietPrs, wakeQuietPrs } from "./quiet";

// PRs with no open items that no search has found for this long are deleted.
const KEEP_UNSEEN_MS = 7 * 24 * 60 * 60 * 1000;

// Why a stored PR stopped being tracked. Its items are resolved.
type EndedState = Exclude<PrState, "open">;

export interface SyncDeps {
  db: Db;
  // A GitHub client acting as the user (see github/client.ts).
  github: (userId: string) => Promise<Octokit>;
  now?: () => Date;
}

export interface SyncResult {
  // Open PRs in watched repos the searches found.
  found: number;
  fetched: number;
  failed: PrDetails["failed"];
  // Tracked PRs that were merged, closed, gone, or in a repo no longer watched.
  ended: number;
  deleted: number;
  // Items that are new or have a new event, to notify about.
  newEventItemIds: string[];
  // Important PRs that just merged, to notify about.
  mergedImportantPrIds: string[];
}

interface StoredPr {
  githubNodeId: string;
  githubRepoId: number;
  githubUpdatedAt: Date;
  checkState: string | null;
  authorLogin: string;
  state: PrState;
  // The open assigned item, if the user is assigned. At most one.
  items: { id: string }[];
}

// New PRs, PRs that changed or are back after they ended, and the user's own or assigned
// PRs whose checks changed. Checks can change without `updatedAt` changing.
function needsDetails(
  pr: PrStatus,
  stored: StoredPr | undefined,
  viewerLogin: string,
): boolean {
  if (!stored || stored.state !== "open") return true;
  if (stored.githubUpdatedAt.getTime() !== pr.updatedAt.getTime()) return true;
  const isOwn = stored.authorLogin.toLowerCase() === viewerLogin.toLowerCase();
  const isAssigned = stored.items.length > 0;
  return (isOwn || isAssigned) && stored.checkState !== pr.checkState;
}

function toRow(snapshot: PrSnapshot, githubRepoId: number) {
  return {
    githubRepoId,
    repoOwner: snapshot.repo.owner,
    repoName: snapshot.repo.name,
    number: snapshot.number,
    title: snapshot.title,
    url: snapshot.url,
    authorLogin: snapshot.author.login,
    isDraft: snapshot.isDraft,
    state: "open" as const,
    headSha: snapshot.headSha,
    checkState: snapshot.checks.state,
    githubUpdatedAt: new Date(snapshot.updatedAt),
    snapshot,
  };
}

interface FromGitHub {
  // PRs the searches found.
  searchedIds: string[];
  // Open PRs in watched repos: found by a search, or tracked and checked by id.
  open: PrStatus[];
  ended: Map<string, EndedState>;
  details: PrDetails;
  // The client used, if GitHub was called.
  octokit: Octokit | null;
  viewerLogin: string;
}

// Searches find new PRs. Tracked PRs the searches missed are checked by id, since the
// search index lags, so a missed PR only ends when it's really merged, closed, or gone.
async function fetchFromGitHub(
  deps: SyncDeps,
  userId: string,
): Promise<FromGitHub> {
  const { db } = deps;
  const [user, settings, watched, stored] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { login: true },
    }),
    db.userSettings.findUnique({
      where: { userId },
      select: { includeTeamRequests: true },
    }),
    db.watchedRepo.findMany({
      where: { userId, enabled: true },
      select: { githubRepoId: true },
    }),
    db.pullRequest.findMany({
      where: { userId },
      select: {
        githubNodeId: true,
        githubRepoId: true,
        githubUpdatedAt: true,
        checkState: true,
        authorLogin: true,
        state: true,
        items: {
          where: { kind: "assigned", status: "open" },
          select: { id: true },
          take: 1,
        },
      },
    }),
  ]);
  // Match on repo id, not name, so a renamed repo keeps syncing.
  const watchedIds = new Set(watched.map((repo) => repo.githubRepoId));
  const tracked = stored.filter((pr) => pr.state === "open");
  const ended = new Map<string, EndedState>(
    tracked
      .filter((pr) => !watchedIds.has(pr.githubRepoId))
      .map((pr) => [pr.githubNodeId, "unwatched"]),
  );
  if (watched.length === 0) {
    const details = { snapshots: [], failed: [] };
    return {
      searchedIds: [],
      open: [],
      ended,
      details,
      octokit: null,
      viewerLogin: user.login,
    };
  }

  const octokit = await deps.github(userId);
  const includeTeamRequests = settings?.includeTeamRequests ?? true;
  const all = await findRelevantPrs(octokit, { includeTeamRequests });
  const found = [...all.values()].filter((pr) =>
    watchedIds.has(pr.githubRepoId),
  );
  const searchedIds = found.map((pr) => pr.id);

  const searched = new Set(searchedIds);
  const missedIds = tracked
    .filter(
      (pr) => watchedIds.has(pr.githubRepoId) && !searched.has(pr.githubNodeId),
    )
    .map((pr) => pr.githubNodeId);
  const open = [...found];
  for (const [id, status] of await fetchPrStatuses(octokit, missedIds)) {
    if (!status) ended.set(id, "gone");
    else if (status.state === "MERGED") ended.set(id, "merged");
    else if (status.state === "CLOSED") ended.set(id, "closed");
    // Moved to a repo the user doesn't watch.
    else if (!watchedIds.has(status.githubRepoId)) ended.set(id, "unwatched");
    else open.push(status);
  }

  const storedById = new Map(stored.map((pr) => [pr.githubNodeId, pr]));
  const changedIds = open
    .filter((pr) => needsDetails(pr, storedById.get(pr.id), user.login))
    .map((pr) => pr.id);
  const details = await fetchPrDetails(octokit, changedIds);
  return {
    searchedIds,
    open,
    ended,
    details,
    octokit,
    viewerLogin: user.login,
  };
}

// Brings the user's stored PRs and items up to date with GitHub.
export async function syncUser(
  deps: SyncDeps,
  userId: string,
): Promise<SyncResult> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const { searchedIds, open, ended, details, octokit, viewerLogin } =
    await fetchFromGitHub(deps, userId);
  // The rules run on every tracked PR, not just the ones that changed, so a wrong item
  // heals on the next sync and a new rule reaches PRs that haven't changed.
  const fetchedIds = new Set(details.snapshots.map((snapshot) => snapshot.id));
  const unchanged = (await trackedPrs(db, userId)).filter(
    (pr) => !fetchedIds.has(pr.snapshot.id) && !ended.has(pr.snapshot.id),
  );
  const detect = await prepareRules(
    db,
    userId,
    [...details.snapshots, ...unchanged.map((pr) => pr.snapshot)],
    now,
    () => (octokit ? Promise.resolve(octokit) : deps.github(userId)),
  );

  const repoIdOf = new Map(open.map((pr) => [pr.id, pr.githubRepoId]));
  // PRs and their items save together, so a PR is never stored without its items.
  const changes = await db.$transaction(async (tx) => {
    await lockUserItems(tx, userId);
    await tx.pullRequest.updateMany({
      where: { userId, githubNodeId: { in: searchedIds } },
      data: { lastSeenAt: now },
    });
    // Read before the upserts, to compare their old snapshots.
    const quiet = await quietPrs(tx, userId);
    const saved: SavedPr[] = [];
    for (const snapshot of details.snapshots) {
      // Details are only fetched for PRs in `open`.
      const row = toRow(snapshot, repoIdOf.get(snapshot.id)!);
      const { id } = await tx.pullRequest.upsert({
        where: { userId_githubNodeId: { userId, githubNodeId: snapshot.id } },
        // New PRs come from the searches.
        create: { userId, githubNodeId: snapshot.id, ...row, lastSeenAt: now },
        update: row,
        select: { id: true },
      });
      saved.push({ id, snapshot });
    }
    const items = await saveItems(
      tx,
      userId,
      [...saved, ...unchanged],
      detect,
      now,
    );
    const woke = await wakeQuietPrs(
      tx,
      quiet,
      saved,
      items.newEventIds,
      viewerLogin,
    );

    // Rows stay, so the items reopen without notifying if the PR comes back.
    const endedAs = (state: EndedState) =>
      [...ended].filter(([, s]) => s === state).map(([id]) => id);
    for (const state of new Set(ended.values())) {
      await tx.pullRequest.updateMany({
        where: { userId, githubNodeId: { in: endedAs(state) } },
        data: { state, ...(state === "merged" && { mergedAt: now }) },
      });
    }
    const mergedIds = endedAs("merged");
    const mergedImportant =
      mergedIds.length === 0
        ? []
        : await tx.pullRequest.findMany({
            where: {
              userId,
              githubNodeId: { in: mergedIds },
              importantAt: { not: null },
            },
            select: { id: true },
          });
    await resolveItemsOf(tx, userId, [...ended.keys()], now);
    // A fetched PR may show a new title, even if its items didn't change. An ended PR
    // leaves My PRs, even with no items.
    if (saved.length > 0 || items.changed || ended.size > 0 || woke > 0) {
      await publishItemsChanged(tx, userId);
    }
    return {
      newEventItemIds: items.newEventIds,
      mergedImportantPrIds: mergedImportant.map((pr) => pr.id),
    };
  }, ITEMS_TX);

  const { count: deleted } = await db.pullRequest.deleteMany({
    where: {
      userId,
      lastSeenAt: { lt: new Date(now.getTime() - KEEP_UNSEEN_MS) },
      items: { none: { status: "open" } },
      // Important PRs stay while open, and once merged, until the user unmarks them.
      NOT: { importantAt: { not: null }, state: { in: ["open", "merged"] } },
    },
  });
  await db.user.update({
    where: { id: userId },
    data: { lastSyncedAt: now },
  });

  return {
    found: searchedIds.length,
    fetched: details.snapshots.length,
    failed: details.failed,
    ended: ended.size,
    deleted,
    ...changes,
  };
}
