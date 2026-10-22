import type { DetectedItem, PrSnapshot } from "@pr-peek/core";
import type { Octokit } from "octokit";
import type { Db } from "./db";
import { fetchPrDetails, type PrDetails } from "./github/pull-details";
import { findRelevantPrs, type FoundPr } from "./github/pull-search";
import { fetchViewerTeams } from "./github/teams";
import {
  detectItems,
  includeDraftsFrom,
  ITEMS_CHANNEL,
  loadRuleSettings,
  resolveUnseenItems,
  saveItems,
  type SavedPr,
} from "./items";

// PRs no search has found for this long are deleted, along with their items.
const KEEP_UNSEEN_MS = 7 * 24 * 60 * 60 * 1000;

export interface SyncDeps {
  db: Db;
  // A GitHub client acting as the user (see github/client.ts).
  github: (userId: string) => Promise<Octokit>;
  now?: () => Date;
}

export interface SyncResult {
  // Open PRs in watched repos that involve the user.
  found: number;
  fetched: number;
  failed: PrDetails["failed"];
  deleted: number;
  // Items that are new or have a new event, to notify about.
  newEventItemIds: string[];
}

interface StoredPr {
  githubUpdatedAt: Date;
  checkState: string | null;
  lastSeenAt: Date;
}

// New PRs, PRs that changed, the user's own PRs whose checks changed, and PRs back in the
// searches after the last sync missed them (their items were resolved then).
function needsDetails(
  pr: FoundPr,
  stored: StoredPr | undefined,
  lastSyncedAt: Date | null,
): boolean {
  if (!stored) return true;
  if (stored.githubUpdatedAt.getTime() !== pr.updatedAt.getTime()) return true;
  if (lastSyncedAt && stored.lastSeenAt < lastSyncedAt) return true;
  return pr.reasons.has("authored") && stored.checkState !== pr.checkState;
}

function toRow(snapshot: PrSnapshot, githubRepoId: number, now: Date) {
  return {
    githubRepoId,
    repoOwner: snapshot.repo.owner,
    repoName: snapshot.repo.name,
    number: snapshot.number,
    title: snapshot.title,
    url: snapshot.url,
    authorLogin: snapshot.author.login,
    isDraft: snapshot.isDraft,
    state: "open",
    headSha: snapshot.headSha,
    checkState: snapshot.checks.state,
    githubUpdatedAt: new Date(snapshot.updatedAt),
    lastSeenAt: now,
    snapshot,
  };
}

interface FromGitHub {
  found: FoundPr[];
  details: PrDetails;
  // Runs the user's enabled rules on one PR.
  detect: (snapshot: PrSnapshot) => DetectedItem[];
}

// The PRs in the user's watched repos, details for the ones that changed, and the rules
// to run on them.
async function fetchFromGitHub(
  deps: SyncDeps,
  userId: string,
  now: Date,
): Promise<FromGitHub> {
  const { db } = deps;
  const [user, settings, watched, ruleSettings] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { login: true, lastSyncedAt: true },
    }),
    db.userSettings.findUnique({
      where: { userId },
      select: { includeTeamRequests: true, hideBots: true },
    }),
    db.watchedRepo.findMany({
      where: { userId, enabled: true },
      select: { githubRepoId: true },
    }),
    loadRuleSettings(db, userId),
  ]);
  if (watched.length === 0) {
    return {
      found: [],
      details: { snapshots: [], failed: [] },
      detect: () => [],
    };
  }
  const watchedIds = new Set(watched.map((repo) => repo.githubRepoId));
  const includeTeamRequests = settings?.includeTeamRequests ?? true;

  const octokit = await deps.github(userId);
  const all = await findRelevantPrs(octokit, { includeTeamRequests });
  // Match on repo id, not name, so a renamed repo keeps syncing.
  const found = [...all.values()].filter((pr) =>
    watchedIds.has(pr.githubRepoId),
  );

  const stored = await db.pullRequest.findMany({
    where: { userId, githubNodeId: { in: found.map((pr) => pr.id) } },
    select: {
      githubNodeId: true,
      githubUpdatedAt: true,
      checkState: true,
      lastSeenAt: true,
    },
  });
  const storedById = new Map(stored.map((pr) => [pr.githubNodeId, pr]));
  const changedIds = found
    .filter((pr) => needsDetails(pr, storedById.get(pr.id), user.lastSyncedAt))
    .map((pr) => pr.id);
  const details = await fetchPrDetails(octokit, changedIds);

  // Only ask for the user's teams when a team was asked to review.
  const hasTeamRequest = details.snapshots.some((snapshot) =>
    snapshot.reviewRequests.some((reviewer) => reviewer.type === "team"),
  );
  const viewerTeams =
    includeTeamRequests && hasTeamRequest
      ? await fetchViewerTeams(octokit, user.login)
      : [];
  const ctx = {
    viewerLogin: user.login,
    viewerTeams,
    now,
    settings: {
      includeTeamRequests,
      hideBots: settings?.hideBots ?? false,
      includeDrafts: includeDraftsFrom(ruleSettings),
    },
  };
  return {
    found,
    details,
    detect: (snapshot) => detectItems(ruleSettings, snapshot, ctx),
  };
}

// Brings the user's stored PRs and items up to date with GitHub.
export async function syncUser(
  deps: SyncDeps,
  userId: string,
): Promise<SyncResult> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const { found, details, detect } = await fetchFromGitHub(deps, userId, now);

  const repoIdOf = new Map(found.map((pr) => [pr.id, pr.githubRepoId]));
  // PRs and their items save together, so a PR is never stored without its items.
  const newEventItemIds = await db.$transaction(
    async (tx) => {
      await tx.pullRequest.updateMany({
        where: { userId, githubNodeId: { in: [...repoIdOf.keys()] } },
        data: { lastSeenAt: now },
      });
      const saved: SavedPr[] = [];
      for (const snapshot of details.snapshots) {
        // Details are only fetched for PRs in `found`.
        const row = toRow(snapshot, repoIdOf.get(snapshot.id)!, now);
        const { id } = await tx.pullRequest.upsert({
          where: { userId_githubNodeId: { userId, githubNodeId: snapshot.id } },
          create: { userId, githubNodeId: snapshot.id, ...row },
          update: row,
          select: { id: true },
        });
        saved.push({ id, snapshot });
      }

      const itemIds = await saveItems(tx, userId, saved, detect, now);
      const resolved = await resolveUnseenItems(tx, userId, now);
      // Sent when the transaction commits.
      if (saved.length > 0 || resolved > 0) {
        await tx.$executeRaw`SELECT pg_notify(${ITEMS_CHANNEL}, ${userId})`;
      }
      return itemIds;
    },
    // Waits for a free connection longer than Prisma's 2 seconds, since syncs share the pool.
    { timeout: 30_000, maxWait: 10_000 },
  );

  const { count: deleted } = await db.pullRequest.deleteMany({
    where: {
      userId,
      lastSeenAt: { lt: new Date(now.getTime() - KEEP_UNSEEN_MS) },
    },
  });
  await db.user.update({
    where: { id: userId },
    data: { lastSyncedAt: now },
  });

  return {
    found: found.length,
    fetched: details.snapshots.length,
    failed: details.failed,
    deleted,
    newEventItemIds,
  };
}
