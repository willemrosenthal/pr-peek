import type { Logger } from "pino";
import { awakeAdmins, pushToAdmins } from "./admin-push";
import type { Db } from "./db";
import type { SendPush } from "./push";
import { dueUsers, SYNCING_USERS } from "./sync-schedule";
import { MINUTE_MS } from "./sync-timing";

export const MB = 1024 * 1024;
export const GB = 1024 * MB;
export const DAY_MS = 24 * 60 * MINUTE_MS;
// Supabase Pro includes 8 GB. Alerts at 70% of it.
export const DB_LIMIT_BYTES = 8 * GB;
export const DB_WARN_SHARE = 0.7;
const DB_WARN_BYTES = DB_WARN_SHARE * DB_LIMIT_BYTES;
// A due sync this late means the worker has stopped keeping up.
const LATE_MS = 15 * MINUTE_MS;
// Syncs failed this many times in a row, so more than a passing GitHub hiccup.
const FAILING_AFTER = 3;
// Alerts when more than this share of the users who sync keep failing.
export const FAILING_SHARE = 0.25;
// Usage counts for the admin page are kept this long.
export const USAGE_KEPT_DAYS = 90;

const users = (count: number) => (count === 1 ? "1 user" : `${count} users`);

export interface HealthDeps {
  db: Db;
  // Null when push is off, because the VAPID keys aren't set.
  send: SendPush | null;
  logger: Logger;
}

export interface Health {
  dbBytes: number;
  // Users 15 minutes or more past their sync interval.
  lateUsers: number;
  syncingUsers: number;
  // Users whose syncs failed several times in a row.
  failingUsers: number;
}

export type AlertKind = "database" | "late" | "failing";

interface Alert {
  kind: AlertKind;
  body: string;
}

export async function readHealth(db: Db, now: Date): Promise<Health> {
  const [[size], due, syncingUsers, failingUsers] = await Promise.all([
    db.$queryRaw<{ bytes: bigint }[]>`
      SELECT pg_database_size(current_database()) AS bytes`,
    dueUsers(db, now),
    db.user.count({ where: SYNCING_USERS }),
    db.user.count({
      where: {
        ...SYNCING_USERS,
        syncError: "failed",
        syncFailures: { gte: FAILING_AFTER },
      },
    }),
  ]);
  return {
    dbBytes: Number(size?.bytes ?? 0),
    lateUsers: due.filter((user) => user.lateMs >= LATE_MS).length,
    syncingUsers,
    failingUsers,
  };
}

// What needs a look, from the numbers.
export function alertsFor(health: Health): Alert[] {
  const alerts: Alert[] = [];
  if (health.dbBytes > DB_WARN_BYTES) {
    const gb = (health.dbBytes / GB).toFixed(1);
    alerts.push({
      kind: "database",
      body: `The database is at ${gb} GB of the ${DB_LIMIT_BYTES / GB} GB in Supabase Pro.`,
    });
  }
  if (health.lateUsers > 0) {
    alerts.push({
      kind: "late",
      body: `Syncs are falling behind: ${users(health.lateUsers)} 15 minutes or more late. Raise SYNC_CONCURRENCY.`,
    });
  }
  if (health.failingUsers > health.syncingUsers * FAILING_SHARE) {
    alerts.push({
      kind: "failing",
      body: `Syncs keep failing for ${health.failingUsers} of ${users(health.syncingUsers)}. Check the worker logs.`,
    });
  }
  return alerts;
}

// Claims today's alert of this kind. False if it went out in the last day. Claimed before
// sending, so a run again never sends it twice. A send that fails waits for tomorrow.
async function claimAlert(db: Db, kind: AlertKind, now: Date) {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const claimed = await db.$queryRaw<unknown[]>`
    INSERT INTO "AdminAlert" ("kind", "sentAt") VALUES (${kind}, ${now})
    ON CONFLICT ("kind") DO UPDATE SET "sentAt" = EXCLUDED."sentAt"
    WHERE "AdminAlert"."sentAt" <= ${dayAgo}
    RETURNING "kind"`;
  return claimed.length > 0;
}

// Logs the numbers, and pushes each alert to every admin, at most once a day each. An
// admin in their quiet hours misses it, unless every admin is: then it waits for them.
// Also deletes old usage counts. Run every hour. Returns the alerts sent.
export async function checkHealth(
  deps: HealthDeps,
  now: Date,
): Promise<AlertKind[]> {
  const { db, send, logger } = deps;
  await db.usageStat.deleteMany({
    where: {
      bucket: { lt: new Date(now.getTime() - USAGE_KEPT_DAYS * DAY_MS) },
    },
  });
  const health = await readHealth(db, now);
  const alerts = alertsFor(health);
  logger.info(
    { ...health, alerts: alerts.map((alert) => alert.kind) },
    "health",
  );
  if (alerts.length === 0 || !send) return [];

  const awake = await awakeAdmins(db, logger, now);
  if (awake.length === 0) return [];

  const sent: AlertKind[] = [];
  for (const { kind, body } of alerts) {
    if (!(await claimAlert(db, kind, now))) continue;
    await pushToAdmins(
      { ...deps, send },
      awake,
      { title: "Git Buddy needs a look", body, url: "/", tag: `alert-${kind}` },
      now,
    );
    sent.push(kind);
  }
  return sent;
}
