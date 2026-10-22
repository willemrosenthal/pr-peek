import { PgBoss } from "pg-boss";
import type pg from "pg";

export const SYNC_DISPATCH = "sync-dispatch";
export const SYNC_USER = "sync-user";
export const NOTIFY_ITEM = "notify-item";
export const SUMMARY_DISPATCH = "summary-dispatch";
export const REMINDER_DISPATCH = "reminder-dispatch";

// A sync running longer than this is given up on.
export const SYNC_TIMEOUT_SECONDS = 10 * 60;

// pg-boss, sharing the pool with Prisma to keep connection counts low.
export function createBoss(
  pool: pg.Pool,
  options: { worker: boolean },
): PgBoss {
  return new PgBoss({
    db: { executeSql: (text, values) => pool.query(text, values) },
    // Only the worker runs scheduled jobs and queue upkeep.
    supervise: options.worker,
    schedule: options.worker,
  });
}

// Creates the queues if they don't exist. Both the worker and the web service call it,
// so either can start first.
export async function createQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(SYNC_DISPATCH);
  // "exclusive" with a singletonKey: one queued or running sync per user.
  // No retries: runSync backs off on its own.
  await boss.createQueue(SYNC_USER, {
    policy: "exclusive",
    retryLimit: 0,
    expireInSeconds: SYNC_TIMEOUT_SECONDS,
  });
  await boss.createQueue(NOTIFY_ITEM);
  await boss.createQueue(SUMMARY_DISPATCH);
  await boss.createQueue(REMINDER_DISPATCH);
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
