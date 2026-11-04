import { isQuiet, type QuietSettings } from "@pr-peek/core";
import { RequestError, type Octokit } from "octokit";
import type { Logger } from "pino";
import type { Db } from "./db";
import {
  markNeedsReauth,
  NeedsReauthError,
  STOP_REASONS,
} from "./github/tokens";
import { POLL_JOBS_SECONDS, POLL_SCHEDULED_SECONDS } from "./jobs";
import { isDesktopOnline } from "./push";
import { syncUser, type SyncDeps } from "./sync";
import { MINUTE_MS, SYNC_TIMING } from "./sync-timing";

const DAY_MS = 24 * 60 * MINUTE_MS;
// Dispatch runs at the start of each minute, and counts from there. A sync starts up to
// both polling intervals after that, so it can look up to 40 seconds short of a whole
// number of minutes. This much slack covers that, and stays under a minute, so a sync is
// never a minute early.
const DISPATCH_SLACK_MS =
  (POLL_SCHEDULED_SECONDS + POLL_JOBS_SECONDS + 5) * 1000;
const MAX_BACKOFF_MS = 30 * MINUTE_MS;
// A due sync this late means the worker is falling behind.
const LAGGING_MS = 2 * MINUTE_MS;
// Below this many GraphQL points left, wait for GitHub's limit to reset.
const LOW_POINTS = 500;

interface RateLimit {
  remaining: number;
  resetAt: Date;
}

export interface ScheduleDeps extends SyncDeps {
  logger: Logger;
  // Queues a notification check for each item that's new or has a new event.
  notifyItems?: (itemIds: string[]) => Promise<void>;
  // Queues a push for each important PR that merged.
  notifyMerged?: (prIds: string[]) => Promise<void>;
}

export interface ScheduleUser {
  lastActiveAt: Date;
  desktopSeenAt: Date | null;
  // Null for a user with no settings row: no quiet hours.
  settings: QuietSettings | null;
}

// How long between the user's syncs. The rules and numbers are in sync-timing.ts.
export function syncIntervalMs(user: ScheduleUser, now: Date): number {
  const t = SYNC_TIMING;
  const sinceActive = now.getTime() - user.lastActiveAt.getTime();
  const minutes =
    sinceActive < t.activeForMinutes * MINUTE_MS
      ? t.activeEveryMinutes
      : user.settings && isQuiet(user.settings, now)
        ? t.quietEveryMinutes
        : isDesktopOnline(user.desktopSeenAt, now)
          ? t.desktopEveryMinutes
          : sinceActive > t.awayAfterDays * DAY_MS
            ? t.awayEveryMinutes
            : t.defaultEveryMinutes;
  return minutes * MINUTE_MS;
}

// 2, 4, 8, 16, then 30 minutes.
export const backoffMs = (failures: number) =>
  Math.min(2 ** failures * MINUTE_MS, MAX_BACKOFF_MS);

export interface DueUser {
  id: string;
  // How long past its interval the sync is. 0 for a user who never synced.
  lateMs: number;
}

export const isLagging = (user: DueUser) => user.lateMs > LAGGING_MS;

// Users whose next sync is due.
export async function dueUsers(db: Db, now: Date): Promise<DueUser[]> {
  const users = await db.user.findMany({
    where: {
      AND: [
        { OR: [{ syncError: null }, { syncError: { notIn: STOP_REASONS } }] },
        { OR: [{ syncRetryAt: null }, { syncRetryAt: { lte: now } }] },
      ],
      watchedRepos: { some: { enabled: true } },
    },
    select: {
      id: true,
      lastSyncedAt: true,
      lastActiveAt: true,
      desktopSeenAt: true,
      settings: {
        select: {
          timezone: true,
          quietStart: true,
          quietEnd: true,
          quietWeekends: true,
        },
      },
    },
  });
  // The start of the minute, not when the worker got to it, which varies.
  const tick = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
  return users.flatMap((user) => {
    const lateMs = user.lastSyncedAt
      ? tick - user.lastSyncedAt.getTime() - syncIntervalMs(user, now)
      : 0;
    return lateMs + DISPATCH_SLACK_MS >= 0 ? [{ id: user.id, lateMs }] : [];
  });
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
  const now = (deps.now ?? (() => new Date()))();
  const setStartedAt = (syncStartedAt: Date | null) =>
    deps.db.user.updateMany({ where: { id: userId }, data: { syncStartedAt } });

  // Shows the sync as running (see GET /api/sync/status). Saving the outcome clears it.
  await setStartedAt(now);
  try {
    await syncAndSchedule(deps, userId, now);
  } catch (err) {
    // Saving the outcome failed, so clear it here.
    await setStartedAt(null);
    throw err;
  }
}

async function syncAndSchedule(
  deps: ScheduleDeps,
  userId: string,
  now: Date,
): Promise<void> {
  const { db } = deps;
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
    // These updates don't ask for the row back, which would send the whole row,
    // tokens included.
    await db.user.updateMany({
      where: { id: userId },
      data: {
        syncError: null,
        syncFailures: 0,
        syncRetryAt: limitResetAt(),
        syncStartedAt: null,
      },
    });
    // After the sync's transaction, so a notification never points at an unsaved item.
    if (result.newEventItemIds.length > 0) {
      await deps.notifyItems?.(result.newEventItemIds);
    }
    if (result.mergedImportantPrIds.length > 0) {
      await deps.notifyMerged?.(result.mergedImportantPrIds);
    }
    log.info({ ...result, rateLimit, ms: Date.now() - started }, "sync done");
  } catch (err) {
    // Dispatch skips these users until they sign in again or add a new token.
    if (needsReauth(err)) {
      const reason = await markNeedsReauth(db, userId);
      await db.user.updateMany({
        where: { id: userId },
        data: { syncStartedAt: null },
      });
      log.info({ reason }, "sync stopped until the user fixes their token");
      return;
    }
    const { syncFailures } = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { syncFailures: true },
    });
    const failures = syncFailures + 1;
    const backoffUntil = new Date(now.getTime() + backoffMs(failures));
    const resetAt = limitResetAt();
    await db.user.updateMany({
      where: { id: userId },
      data: {
        syncError: "failed",
        syncFailures: failures,
        syncRetryAt: resetAt && resetAt > backoffUntil ? resetAt : backoffUntil,
        syncStartedAt: null,
      },
    });
    log.warn({ err, failures, rateLimit }, "sync failed");
  }
}
