import { PgBoss, type Queue, type QueueOptions } from "pg-boss";
import type pg from "pg";

export const SYNC_DISPATCH = "sync-dispatch";
export const SYNC_USER = "sync-user";
// One job per sync, with all its new items, so they can go out as one push.
export const NOTIFY_ITEMS = "notify-items";
// Important PRs that merged in one sync.
export const NOTIFY_MERGED = "notify-merged";
export const SUMMARY_DISPATCH = "summary-dispatch";
export const REMINDER_DISPATCH = "reminder-dispatch";
// Checks usage once an hour, and alerts the admin (see health.ts).
export const HEALTH_CHECK = "health-check";
// Logs once a minute, to show the worker is alive.
export const HEARTBEAT = "heartbeat";

// A sync running longer than this is given up on.
export const SYNC_TIMEOUT_SECONDS = 10 * 60;

// Finished jobs of queues that run often are deleted after an hour, not pg-boss's 7 days,
// so the job table stays small.
const FREQUENT = { deleteAfterSeconds: 60 * 60 };

// How often the worker checks each queue for jobs, in seconds. pg-boss's 2 seconds would
// mean millions of queries a month with no users at all. Pushes wait up to 10 seconds.
export const POLL_JOBS_SECONDS = 10;
// Scheduled queues, like the sync dispatch. With POLL_JOBS_SECONDS, must add up to under
// 55 seconds (see DISPATCH_SLACK_MS in sync-schedule.ts).
export const POLL_SCHEDULED_SECONDS = 30;

// pg-boss's own queue, which every scheduled job passes through.
export const SEND_IT = "__pgboss__send-it";

// How often pg-boss deletes finished jobs past their time. Its default is once a day, so
// an hour's keep would really be up to 25 hours.
const CLEANUP_EVERY_SECONDS = 60 * 60;
// How often each process re-reads every queue's settings, about 3 KB each time. They only
// change when we deploy, and pg-boss forgets a queue's when we change it. pg-boss's 60
// seconds made these reads about a fifth of all egress.
const QUEUE_CACHE_SECONDS = 60 * 60;

// pg-boss, sharing the pool with Prisma to keep connection counts low.
export function createBoss(
  pool: pg.Pool,
  options: { worker: boolean; schema?: string },
): PgBoss {
  return new PgBoss({
    db: { executeSql: (text, values) => pool.query(text, values) },
    // Only the worker runs scheduled jobs and queue upkeep.
    supervise: options.worker,
    schedule: options.worker,
    maintenanceIntervalSeconds: CLEANUP_EVERY_SECONDS,
    queueCacheIntervalSeconds: QUEUE_CACHE_SECONDS,
    ...(options.schema && { schema: options.schema }),
  });
}

// Creates a queue, or updates the options of one that exists. `createQueue` leaves an
// existing queue as it was. A policy can't change after the queue is made.
async function ensureQueue(
  boss: PgBoss,
  name: string,
  options: QueueOptions = {},
  policy?: Queue["policy"],
): Promise<void> {
  await boss.createQueue(name, { ...options, ...(policy && { policy }) });
  // pg-boss refuses an update with nothing in it.
  if (Object.keys(options).length > 0) await boss.updateQueue(name, options);
}

// Creates the queues if they don't exist. Both the worker and the web service call it,
// so either can start first.
export async function createQueues(boss: PgBoss): Promise<void> {
  await ensureQueue(boss, SYNC_DISPATCH, FREQUENT);
  // "exclusive" with a singletonKey: one queued or running sync per user.
  // No retries: runSync backs off on its own.
  await ensureQueue(
    boss,
    SYNC_USER,
    { ...FREQUENT, retryLimit: 0, expireInSeconds: SYNC_TIMEOUT_SECONDS },
    "exclusive",
  );
  await ensureQueue(boss, NOTIFY_ITEMS);
  await ensureQueue(boss, NOTIFY_MERGED);
  // Scheduled: a finished run is no use after it.
  await ensureQueue(boss, SUMMARY_DISPATCH, FREQUENT);
  await ensureQueue(boss, REMINDER_DISPATCH, FREQUENT);
  await ensureQueue(boss, HEALTH_CHECK, FREQUENT);
  await ensureQueue(boss, HEARTBEAT, FREQUENT);
  // pg-boss's own, made here too, so its finished jobs go after an hour, not 7 days.
  await ensureQueue(boss, SEND_IT, FREQUENT);
}

// Queues a sync for the user. False if one was already queued or running.
export async function queueSync(
  boss: PgBoss,
  userId: string,
): Promise<boolean> {
  const jobId = await boss.send(
    SYNC_USER,
    { userId },
    { singletonKey: userId },
  );
  return jobId !== null;
}
