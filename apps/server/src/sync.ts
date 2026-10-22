import type { PrSnapshot } from "@pr-peek/core";
import type { Octokit } from "octokit";
import type { Db } from "./db";
import { fetchPrDetails, type PrDetails } from "./github/pull-details";
import { findRelevantPrs, type FoundPr } from "./github/pull-search";

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
}

// New PRs, PRs that changed, and the user's own PRs whose checks changed.
function needsDetails(
  pr: FoundPr,
  stored: { githubUpdatedAt: Date; checkState: string | null } | undefined,
): boolean {
  if (!stored) return true;
  if (stored.githubUpdatedAt.getTime() !== pr.updatedAt.getTime()) return true;
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

// Brings the user's stored PRs up to date with GitHub.
export async function syncUser(
  deps: SyncDeps,
  userId: string,
): Promise<SyncResult> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();

  const [settings, watched] = await Promise.all([
    db.userSettings.findUnique({
      where: { userId },
      select: { includeTeamRequests: true },
    }),
    db.watchedRepo.findMany({
      where: { userId, enabled: true },
      select: { githubRepoId: true },
    }),
  ]);
  const watchedIds = new Set(watched.map((repo) => repo.githubRepoId));

  let found: FoundPr[] = [];
  let details: PrDetails = { snapshots: [], failed: [] };
  if (watchedIds.size > 0) {
    const octokit = await deps.github(userId);
    const all = await findRelevantPrs(octokit, {
      includeTeamRequests: settings?.includeTeamRequests ?? true,
    });
    // Match on repo id, not name, so a renamed repo keeps syncing.
    found = [...all.values()].filter((pr) => watchedIds.has(pr.githubRepoId));

    const stored = await db.pullRequest.findMany({
      where: { userId, githubNodeId: { in: found.map((pr) => pr.id) } },
      select: { githubNodeId: true, githubUpdatedAt: true, checkState: true },
    });
    const storedById = new Map(stored.map((pr) => [pr.githubNodeId, pr]));
    const changed = found.filter((pr) =>
      needsDetails(pr, storedById.get(pr.id)),
    );
    details = await fetchPrDetails(
      octokit,
      changed.map((pr) => pr.id),
    );
  }

  const repoIdOf = new Map(found.map((pr) => [pr.id, pr.githubRepoId]));
  await db.$transaction([
    db.pullRequest.updateMany({
      where: { userId, githubNodeId: { in: found.map((pr) => pr.id) } },
      data: { lastSeenAt: now },
    }),
    ...details.snapshots.map((snapshot) => {
      // Details are only fetched for PRs in `found`.
      const row = toRow(snapshot, repoIdOf.get(snapshot.id)!, now);
      return db.pullRequest.upsert({
        where: { userId_githubNodeId: { userId, githubNodeId: snapshot.id } },
        create: { userId, githubNodeId: snapshot.id, ...row },
        update: row,
      });
    }),
  ]);

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
  };
}
