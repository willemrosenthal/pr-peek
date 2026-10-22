import { RequestError, type Octokit } from "octokit";
import type { Logger } from "pino";
import type { Db } from "./db";
import { NeedsReauthError } from "./github/tokens";
import { syncUser, type SyncDeps } from "./sync";

const MINUTE_MS = 60 * 1000;
const ACTIVE_INTERVAL_MS = MINUTE_MS;
const IDLE_INTERVAL_MS = 15 * MINUTE_MS;
// Users who haven't opened the app for this long sync less often.
const IDLE_AFTER_MS = 14 * 24 * 60 * MINUTE_MS;
// Dispatch runs once a minute, so a sync a few seconds short of its interval still counts as due.
const DISPATCH_SLACK_MS = 15 * 1000;
const MAX_BACKOFF_MS = 30 * MINUTE_MS;
// Below this many GraphQL points left, wait for GitHub's limit to reset.
const LOW_POINTS = 500;

export interface RateLimit {
  remaining: number;
  resetAt: Date;
}

export interface ScheduleDeps extends SyncDeps {
  logger: Logger;
}

const syncInterval = (lastActiveAt: Date, now: Date) =>
  now.getTime() - lastActiveAt.getTime() > IDLE_AFTER_MS
    ? IDLE_INTERVAL_MS
    : ACTIVE_INTERVAL_MS;

// 2, 4, 8, 16, then 30 minutes.
export const backoffMs = (failures: number) =>
  Math.min(2 ** failures * MINUTE_MS, MAX_BACKOFF_MS);

// Users whose next sync is due.
export async function dueUserIds(db: Db, now: Date): Promise<string[]> {
  const users = await db.user.findMany({
    where: {
      AND: [
        { OR: [{ syncError: null }, { syncError: { not: "reauth" } }] },
        { OR: [{ syncRetryAt: null }, { syncRetryAt: { lte: now } }] },
      ],
      watchedRepos: { some: { enabled: true } },
    },
    select: { id: true, lastSyncedAt: true, lastActiveAt: true },
  });
  return users
    .filter(
      ({ lastSyncedAt, lastActiveAt }) =>
        !lastSyncedAt ||
        now.getTime() - lastSyncedAt.getTime() + DISPATCH_SLACK_MS >=
          syncInterval(lastActiveAt, now),
    )
    .map((user) => user.id);
}

// Calls `onLimit` with GitHub's rate limit after each response.
function watchRateLimit(
  octokit: Octokit,
  onLimit: (limit: RateLimit) => void,
): void {
  const read = (headers: Record<string, unknown> | undefined) => {
    const remaining = Number(headers?.["x-ratelimit-remaining"]);
    const reset = Number(headers?.["x-ratelimit-reset"]);
    if (Number.isFinite(remaining) && Number.isFinite(reset)) {
      onLimit({ remaining, resetAt: new Date(reset * 1000) });
    }
  };
  octokit.hook.after("request", (response) => read(response.headers));
  octokit.hook.error("request", (error) => {
    if (error instanceof RequestError) read(error.response?.headers);
    throw error;
  });
}

const needsReauth = (err: unknown) =>
  err instanceof NeedsReauthError ||
  (err instanceof RequestError && err.status === 401);

// Runs one sync and schedules the next. Failures back off instead of throwing.
export async function runSync(
  deps: ScheduleDeps,
  userId: string,
): Promise<void> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const started = Date.now();
  const log = deps.logger.child({ userId });
  let rateLimit: RateLimit | undefined;
  const github = async (id: string) => {
    const octokit = await deps.github(id);
    watchRateLimit(octokit, (limit) => (rateLimit = limit));
    return octokit;
  };
  // When GitHub's limit resets, if we're nearly out of points.
  const limitResetAt = () =>
    rateLimit && rateLimit.remaining < LOW_POINTS ? rateLimit.resetAt : null;

  try {
    const result = await syncUser({ ...deps, github, now: () => now }, userId);
    await db.user.update({
      where: { id: userId },
      data: { syncError: null, syncFailures: 0, syncRetryAt: limitResetAt() },
    });
    log.info({ ...result, rateLimit, ms: Date.now() - started }, "sync done");
  } catch (err) {
    // The user is already marked "reauth", so dispatch skips them until they sign in.
    if (needsReauth(err)) {
      log.info("sync stopped until the user signs in again");
      return;
    }
    const { syncFailures } = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { syncFailures: true },
    });
    const failures = syncFailures + 1;
    const backoffUntil = new Date(now.getTime() + backoffMs(failures));
    const resetAt = limitResetAt();
    await db.user.update({
      where: { id: userId },
      data: {
        syncError: "failed",
        syncFailures: failures,
        syncRetryAt: resetAt && resetAt > backoffUntil ? resetAt : backoffUntil,
      },
    });
    log.warn({ err, failures, rateLimit }, "sync failed");
  }
}
