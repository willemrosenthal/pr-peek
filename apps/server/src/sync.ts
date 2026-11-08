import { assignedState, lastPushSha, type PrSnapshot } from "@pr-peek/core";
import { RequestError, type Octokit } from "octokit";
import type { GitHubFor } from "./github/client";
import type { Db } from "./db";
import type { PrState, Prisma } from "./generated/prisma/client";
import { fetchPrDetails, type PrDetails } from "./github/pull-details";
import {
  fetchPrStatuses,
  findRelevantPrs,
  type PrStatus,
} from "./github/pull-search";
import { listTokenOwners } from "./github/repos";
import { fetchViewerTeams } from "./github/teams";
import { isRejection, pickToken, type PickableToken } from "./github/tokens";
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

// PRs to delete: none of their items are open, and no search has found them for
// KEEP_UNSEEN_MS. Important PRs stay while open, and once merged, until unmarked.
export const unseenPrs = (now: Date) =>
  ({
    lastSeenAt: { lt: new Date(now.getTime() - KEEP_UNSEEN_MS) },
    items: { none: { status: "open" } },
    NOT: { importantAt: { not: null }, state: { in: ["open", "merged"] } },
  }) satisfies Prisma.PullRequestWhereInput;
// How often a found PR's `lastSeenAt` moves forward, at most.
const LAST_SEEN_EVERY_MS = 60 * 60 * 1000;
// `githubUpdatedAt` for a PR added by its link and not synced yet. Older than any real
// change, so the next sync fetches its details.
export const NEVER_SYNCED = new Date(0);
// How long the user's team list is kept. Joining a team takes up to this long to show.
const TEAMS_KEPT_MS = 60 * 60 * 1000;
// How long a token's owners are kept before they're checked again.
const OWNERS_KEPT_MS = 24 * 60 * 60 * 1000;

// Why a stored PR stopped being tracked. Its items are resolved.
type EndedState = Exclude<PrState, "open">;

export interface SyncDeps {
  db: Db;
  // A GitHub client acting as the user (see github/client.ts).
  github: GitHubFor;
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
  checkFingerprint: string | null;
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
  return (
    (isOwn || isAssigned) && stored.checkFingerprint !== pr.checkFingerprint
  );
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
    checkFingerprint: snapshot.checks.fingerprint ?? null,
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

// The user's personal access tokens, after saving which owners each working fine-grained
// token reaches, if they were never checked or are a day old. Classic tokens reach every
// owner, so they're skipped. GitHub errors skip the token until the next sync. One it
// rejects is marked stopped, here and by its client.
export async function refreshTokenOwners(
  deps: SyncDeps,
  userId: string,
  now: Date,
): Promise<PickableToken[]> {
  const tokens = await deps.db.gitHubToken.findMany({
    where: { userId },
    select: {
      id: true,
      kind: true,
      owners: true,
      ownersCheckedAt: true,
      status: true,
      createdAt: true,
    },
  });
  const staleBefore = now.getTime() - OWNERS_KEPT_MS;
  for (const token of tokens) {
    if (
      token.status !== "working" ||
      token.kind === "classic" ||
      (token.ownersCheckedAt && token.ownersCheckedAt.getTime() >= staleBefore)
    ) {
      continue;
    }
    try {
      token.owners = await listTokenOwners(
        await deps.github(userId, { tokenId: token.id }),
      );
      await deps.db.gitHubToken.updateMany({
        where: { id: token.id },
        data: { owners: token.owners, ownersCheckedAt: now },
      });
    } catch (err) {
      if (isRejection(err)) token.status = "stopped";
      else if (!(err instanceof RequestError)) throw err;
    }
  }
  return tokens;
}

// One GitHub client per token, made when first needed. Null is the sign in.
function tokenClients(
  deps: SyncDeps,
  userId: string,
  tokens: PickableToken[],
  // The sign in stopped working while a token worked (see markRejected).
  signInStopped: boolean,
) {
  const clients = new Map<string | null, Promise<Octokit>>();
  const client = (tokenId: string | null) => {
    let made = clients.get(tokenId);
    if (!made) {
      made = deps.github(userId, { tokenId });
      clients.set(tokenId, made);
    }
    return made;
  };
  const [newestWorking] = tokens
    .filter((token) => token.status === "working")
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return {
    // For what isn't about one owner, like the user's teams.
    forDefault: () => client(newestWorking?.id ?? null),
    // Runs `work` once per token, with the items whose owners it's picked for (see
    // pickToken). When the sign in stopped working but a token works, the sign in's
    // items are skipped, so the rest still sync. It's only tried again after the user
    // signs in again. A token GitHub rejects fails the sync: it's marked stopped, so the
    // next one, soon after, picks another for its owners.
    async each<T>(
      items: T[],
      ownerOf: (item: T) => string,
      work: (octokit: Octokit, items: T[]) => Promise<void>,
    ): Promise<void> {
      const groups = new Map<string | null, T[]>();
      for (const item of items) {
        const tokenId = pickToken(tokens, ownerOf(item));
        const group = groups.get(tokenId);
        if (group) group.push(item);
        else groups.set(tokenId, [item]);
      }
      for (const [tokenId, group] of groups) {
        if (tokenId === null && signInStopped && newestWorking) continue;
        try {
          await work(await client(tokenId), group);
        } catch (err) {
          if (tokenId === null && newestWorking && isRejection(err)) continue;
          throw err;
        }
      }
    },
  };
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
        signInStoppedAt: true,
        // In the same query, to skip checking tokens' owners for users with none.
        _count: { select: { githubTokens: true } },
      },
    }),
    db.userSettings.findUnique({
      where: { userId },
      select: { includeTeamRequests: true, hideBots: true },
    }),
    db.watchedRepo.findMany({
      where: { userId, enabled: true },
      select: { githubRepoId: true, owner: true },
    }),
    db.pullRequest.findMany({
      where: { userId },
      select: {
        githubNodeId: true,
        githubRepoId: true,
        repoOwner: true,
        githubUpdatedAt: true,
        checkFingerprint: true,
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

  const tokens =
    user._count.githubTokens > 0
      ? await refreshTokenOwners(deps, userId, now)
      : [];
  const github = tokenClients(
    deps,
    userId,
    tokens,
    user.signInStoppedAt !== null,
  );
  const teams = includeTeamRequests
    ? await currentTeams(await github.forDefault(), user, now)
    : { teams: [], changed: false, checked: false };
  // The rules give the same items for a PR that didn't change, unless their code, the
  // user's settings, or their teams did.
  const staleAfter = Math.max(
    deps.rulesChangedAt?.getTime() ?? 0,
    user.rulesStaleAt?.getTime() ?? 0,
  );
  const fullPass =
    !user.rulesRunAt || user.rulesRunAt.getTime() < staleAfter || teams.changed;
  // Each PR's owner, to pick its token: from its watched repo, else its stored row.
  const watchedOwner = new Map(
    watched.map((repo) => [repo.githubRepoId, repo.owner]),
  );
  const storedById = new Map(stored.map((pr) => [pr.githubNodeId, pr]));
  const ownerOf = (id: string, githubRepoId?: number) =>
    (githubRepoId === undefined ? undefined : watchedOwner.get(githubRepoId)) ??
    storedById.get(id)?.repoOwner ??
    "";

  // The searches only find PRs in watched repos. They run once per token those repos
  // use, and the results are merged.
  const all = new Map<string, PrStatus>();
  await github.each(
    [...new Set(watched.map((repo) => repo.owner))],
    (owner) => owner,
    async (octokit) => {
      for (const [id, pr] of await findRelevantPrs(octokit, {
        includeTeamRequests,
      })) {
        all.set(id, pr);
      }
    },
  );
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
  // A PR skipped here (see tokenClients) is left as it is: not ended or updated.
  await github.each(
    missedIds,
    (id) => ownerOf(id),
    async (octokit, ids) => {
      for (const [id, status] of await fetchPrStatuses(octokit, ids)) {
        if (!status) ended.set(id, "gone");
        else if (status.state === "MERGED") ended.set(id, "merged");
        else if (status.state === "CLOSED") ended.set(id, "closed");
        // Moved to a repo the user doesn't watch.
        else if (!isWatched(id, status.githubRepoId)) {
          ended.set(id, "unwatched");
        } else open.push(status);
      }
    },
  );

  const fetchPrs = open.filter(
    (pr) => fullPass || needsDetails(pr, storedById.get(pr.id), user.login),
  );
  const details: PrDetails = { snapshots: [], failed: [] };
  await github.each(
    fetchPrs,
    (pr) => ownerOf(pr.id, pr.githubRepoId),
    async (octokit, prs) => {
      const got = await fetchPrDetails(
        octokit,
        prs.map((pr) => pr.id),
      );
      details.snapshots.push(...got.snapshots);
      details.failed.push(...got.failed);
    },
  );
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
    where: { userId, ...unseenPrs(now) },
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
