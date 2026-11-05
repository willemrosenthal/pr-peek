import { assignedState, lastPushSha, type PrSnapshot } from "@pr-peek/core";
import type { Octokit } from "octokit";
import type { Db } from "./db";
import type { PrState } from "./generated/prisma/client";
import { fetchPrDetails, type PrDetails } from "./github/pull-details";
import {
  fetchPrStatuses,
  findRelevantPrs,
  type PrStatus,
} from "./github/pull-search";
import { fetchViewerTeams } from "./github/teams";
import { idleGroup } from "./item-list";
import {
  ITEMS_TX,
  lockUserItems,
  prepareRules,
  publishItemsChanged,
  resolveItemsOf,
  saveItems,
  type SavedPr,
  type Viewer,
} from "./items";
import { quietPrs, wakeQuietPrs } from "./quiet";

// PRs with no open items that no search has found for this long are deleted.
export const KEEP_UNSEEN_MS = 7 * 24 * 60 * 60 * 1000;
// How often a found PR's `lastSeenAt` moves forward, at most.
const LAST_SEEN_EVERY_MS = 60 * 60 * 1000;
// `githubUpdatedAt` for a PR added by its link and not synced yet. Older than any real
// change, so the next sync fetches its details.
export const NEVER_SYNCED = new Date(0);
// How long the user's team list is kept. Joining a team takes up to this long to show.
const TEAMS_KEPT_MS = 60 * 60 * 1000;

// Why a stored PR stopped being tracked. Its items are resolved.
type EndedState = Exclude<PrState, "open">;

export interface SyncDeps {
  db: Db;
  // A GitHub client acting as the user (see github/client.ts).
  github: (userId: string) => Promise<Octokit>;
  now?: () => Date;
  // When the rules' code last changed: the worker's start. A user whose last full pass is
  // older gets one, so new or fixed rules reach every PR.
  rulesChangedAt?: Date;
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
  // Fetched every open PR and ran the rules on all of them.
  fullPass: boolean;
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

// What the list needs from a PR's details, kept on its row.
const snapshotColumns = (snapshot: PrSnapshot, viewerLogin: string) => ({
  lastPushSha: lastPushSha(snapshot),
  listGroup: idleGroup(snapshot, viewerLogin),
  assignedState: assignedState(snapshot),
});

function toRow(
  snapshot: PrSnapshot,
  githubRepoId: number,
  viewerLogin: string,
) {
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
    // GitHub's own state, which the searches give, so a later sync can tell it changed.
    checkState: snapshot.checks.githubState ?? snapshot.checks.state,
    githubUpdatedAt: new Date(snapshot.updatedAt),
    ...snapshotColumns(snapshot, viewerLogin),
  };
}

interface TeamsUser {
  login: string;
  teams: string[];
  teamsCheckedAt: Date | null;
}

interface Teams {
  teams: string[];
  // Differ from the ones kept on the user's row.
  changed: boolean;
  // Asked GitHub, so the sync saves them when it ends. Not before: if the sync failed
  // after saving them, the next one wouldn't see the change.
  checked: boolean;
}

// The user's teams, checked with GitHub at most once an hour.
async function currentTeams(
  octokit: Octokit,
  user: TeamsUser,
  now: Date,
): Promise<Teams> {
  const checkedAt = user.teamsCheckedAt?.getTime();
  if (checkedAt !== undefined && now.getTime() - checkedAt < TEAMS_KEPT_MS) {
    return { teams: user.teams, changed: false, checked: false };
  }
  const teams = (await fetchViewerTeams(octokit, user.login)).toSorted();
  const changed = teams.join(" ") !== user.teams.join(" ");
  return { teams, changed, checked: true };
}

interface FromGitHub {
  // PRs the searches found.
  searchedIds: string[];
  // Open PRs in watched repos, or added by their link: found by a search, or tracked and
  // checked by id.
  open: PrStatus[];
  ended: Map<string, EndedState>;
  details: PrDetails;
  viewer: Viewer;
  // Teams just checked with GitHub, to save when the sync ends. Null if not checked.
  checkedTeams: string[] | null;
  fullPass: boolean;
  // PRs added by their link and never synced. Their first items are old news.
  firstSyncIds: Set<string>;
}

// Searches find new PRs. Tracked PRs the searches missed are checked by id, since the
// search index lags, so a missed PR only ends when it's really merged, closed, or gone.
// PRs the user added by their link are tracked whatever their repo.
// Fetches the details of PRs that changed, or of every open PR on a full pass.
async function fetchFromGitHub(
  deps: SyncDeps,
  userId: string,
  now: Date,
): Promise<FromGitHub> {
  const { db } = deps;
  const [user, settings, watched, stored] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        login: true,
        rulesRunAt: true,
        rulesStaleAt: true,
        teams: true,
        teamsCheckedAt: true,
      },
    }),
    db.userSettings.findUnique({
      where: { userId },
      select: { includeTeamRequests: true, hideBots: true },
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
        addedAt: true,
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
  const addedIds = new Set(
    tracked.filter((pr) => pr.addedAt).map((pr) => pr.githubNodeId),
  );
  const isWatched = (id: string, githubRepoId: number) =>
    watchedIds.has(githubRepoId) || addedIds.has(id);
  const ended = new Map<string, EndedState>(
    tracked
      .filter((pr) => !isWatched(pr.githubNodeId, pr.githubRepoId))
      .map((pr) => [pr.githubNodeId, "unwatched"]),
  );
  const includeTeamRequests = settings?.includeTeamRequests ?? true;
  const viewer: Viewer = {
    login: user.login,
    teams: [],
    includeTeamRequests,
    hideBots: settings?.hideBots ?? false,
  };
  if (watched.length === 0 && addedIds.size === 0) {
    const details = { snapshots: [], failed: [] };
    return {
      searchedIds: [],
      open: [],
      ended,
      details,
      viewer,
      checkedTeams: null,
      fullPass: false,
      firstSyncIds: new Set(),
    };
  }

  const octokit = await deps.github(userId);
  const teams = includeTeamRequests
    ? await currentTeams(octokit, user, now)
    : { teams: [], changed: false, checked: false };
  // The rules give the same items for a PR that didn't change, unless their code, the
  // user's settings, or their teams did.
  const staleAfter = Math.max(
    deps.rulesChangedAt?.getTime() ?? 0,
    user.rulesStaleAt?.getTime() ?? 0,
  );
  const fullPass =
    !user.rulesRunAt || user.rulesRunAt.getTime() < staleAfter || teams.changed;
  // The searches only find PRs in watched repos.
  const all =
    watched.length > 0
      ? await findRelevantPrs(octokit, { includeTeamRequests })
      : new Map<string, PrStatus>();
  const found = [...all.values()].filter((pr) =>
    isWatched(pr.id, pr.githubRepoId),
  );
  const searchedIds = found.map((pr) => pr.id);

  const searched = new Set(searchedIds);
  const missedIds = tracked
    .filter(
      (pr) =>
        isWatched(pr.githubNodeId, pr.githubRepoId) &&
        !searched.has(pr.githubNodeId),
    )
    .map((pr) => pr.githubNodeId);
  const open = [...found];
  for (const [id, status] of await fetchPrStatuses(octokit, missedIds)) {
    if (!status) ended.set(id, "gone");
    else if (status.state === "MERGED") ended.set(id, "merged");
    else if (status.state === "CLOSED") ended.set(id, "closed");
    // Moved to a repo the user doesn't watch.
    else if (!isWatched(id, status.githubRepoId)) ended.set(id, "unwatched");
    else open.push(status);
  }

  const storedById = new Map(stored.map((pr) => [pr.githubNodeId, pr]));
  const fetchIds = open
    .filter(
      (pr) => fullPass || needsDetails(pr, storedById.get(pr.id), user.login),
    )
    .map((pr) => pr.id);
  const details = await fetchPrDetails(octokit, fetchIds);
  return {
    searchedIds,
    open,
    ended,
    details,
    viewer: { ...viewer, teams: teams.teams },
    checkedTeams: teams.checked ? teams.teams : null,
    fullPass,
    firstSyncIds: new Set(
      tracked
        .filter(
          (pr) =>
            pr.addedAt &&
            pr.githubUpdatedAt.getTime() === NEVER_SYNCED.getTime(),
        )
        .map((pr) => pr.githubNodeId),
    ),
  };
}

// Brings the user's stored PRs and items up to date with GitHub.
export async function syncUser(
  deps: SyncDeps,
  userId: string,
): Promise<SyncResult> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const {
    searchedIds,
    open,
    ended,
    details,
    viewer,
    checkedTeams,
    fullPass,
    firstSyncIds,
  } = await fetchFromGitHub(deps, userId, now);
  const viewerLogin = viewer.login;
  // The rules run only on the PRs just fetched. A PR that didn't change keeps its items.
  const detect = await prepareRules(db, userId, now, viewer);

  const repoIdOf = new Map(open.map((pr) => [pr.id, pr.githubRepoId]));
  // PRs and their items save together, so a PR is never stored without its items.
  const changes = await db.$transaction(async (tx) => {
    await lockUserItems(tx, userId);
    // Only once an hour, since it's checked against days. Saves rewriting every row.
    await tx.pullRequest.updateMany({
      where: {
        userId,
        githubNodeId: { in: searchedIds },
        lastSeenAt: { lt: new Date(now.getTime() - LAST_SEEN_EVERY_MS) },
      },
      data: { lastSeenAt: now },
    });
    // Read before the upserts, to compare their last push with the new one.
    const quiet = await quietPrs(
      tx,
      userId,
      details.snapshots.map((snapshot) => snapshot.id),
    );
    const saved: SavedPr[] = [];
    for (const snapshot of details.snapshots) {
      // Details are only fetched for PRs in `open`.
      const row = toRow(snapshot, repoIdOf.get(snapshot.id)!, viewerLogin);
      const { id } = await tx.pullRequest.upsert({
        where: { userId_githubNodeId: { userId, githubNodeId: snapshot.id } },
        // New PRs come from the searches.
        create: { userId, githubNodeId: snapshot.id, ...row, lastSeenAt: now },
        update: row,
        select: { id: true },
      });
      saved.push({
        id,
        snapshot,
        itemsStartSeen: firstSyncIds.has(snapshot.id),
      });
    }
    const items = await saveItems(tx, userId, saved, detect, now);
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
  await db.user.updateMany({
    where: { id: userId },
    data: {
      lastSyncedAt: now,
      ...(fullPass && { rulesRunAt: now }),
      ...(checkedTeams && { teams: checkedTeams, teamsCheckedAt: now }),
    },
  });

  return {
    found: searchedIds.length,
    fetched: details.snapshots.length,
    failed: details.failed,
    ended: ended.size,
    deleted,
    ...changes,
    fullPass,
  };
}
