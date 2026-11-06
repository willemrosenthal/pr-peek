import type { AdminOverviewResponse } from "@pr-peek/core";
import type { Db } from "./db";
import { Prisma } from "./generated/prisma/client";
import {
  DAY_MS,
  DB_LIMIT_MB,
  DB_WARN_SHARE,
  FAILING_SHARE,
  MB,
  readHealth,
} from "./health";

// What the admin page shows. Read only when it opens, and every query groups and limits
// in SQL, so the answer is tens of rows. See docs/19-admin.md, "Cost rules".

// Supabase's free plan includes 5 GB of egress a month.
const EGRESS_LIMIT_BYTES = 5 * 1024 * MB;
const EGRESS_WATCH_SHARE = 0.8;
// pg-boss keeps finished jobs of frequent queues for an hour, so about 60 a user (plan 16).
const JOB_ROWS_PER_USER = 60;
// Queries shown from Postgres's stats, and the kinds of read shown.
const TOP = 8;
// Query text is cut to this, so long queries don't make the answer big.
const QUERY_CHARS = 160;

// Sums come back from Postgres as bigint, or null over no rows.
const num = (n: bigint | number | null | undefined) => Number(n ?? 0);
const numOrNull = (n: bigint | null | undefined) =>
  n === null || n === undefined ? null : Number(n);
const iso = (date: Date) => date.toISOString();

const startOfDay = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

// Rows in pg-boss's job table. Null when it isn't there, like in tests.
async function jobRows(db: Db): Promise<number | null> {
  try {
    const [row] = await db.$queryRaw<{ rows: bigint }[]>`
      SELECT count(*) AS rows FROM pgboss.job`;
    return num(row?.rows);
  } catch {
    return null;
  }
}

// The most frequent queries in this database, from the stats in `schema`.
async function topQueriesIn(
  db: Db,
  schema: string,
): Promise<NonNullable<AdminOverviewResponse["queries"]>> {
  const from = Prisma.raw(schema);
  const top = await db.$queryRaw<
    { query: string; calls: bigint; meanMs: number; rows: bigint }[]
  >`
      SELECT left(regexp_replace(query, '\\s+', ' ', 'g'), ${QUERY_CHARS}) AS query,
        calls, mean_exec_time AS "meanMs", rows
      FROM ${from}pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      ORDER BY calls DESC
      LIMIT ${TOP}`;
  const [info] = await db.$queryRaw<{ since: Date | null }[]>`
      SELECT stats_reset AS since FROM ${from}pg_stat_statements_info`.catch(
    () => [],
  );
  return {
    since: info?.since ? iso(info.since) : null,
    top: top.map((q) => ({
      query: q.query,
      calls: num(q.calls),
      meanMs: Number(q.meanMs),
      rows: num(q.rows),
    })),
  };
}

// The most frequent queries. Null when the stats can't be read: the extension is off,
// or our role can't see them. Supabase keeps it in "extensions", which may not be on
// the search path.
export async function topQueries(
  db: Db,
): Promise<AdminOverviewResponse["queries"]> {
  for (const schema of ["", "extensions."]) {
    try {
      return await topQueriesIn(db, schema);
    } catch {
      // Try the next place.
    }
  }
  return null;
}

export async function readOverview(
  db: Db,
  now: Date,
): Promise<AdminOverviewResponse> {
  const today = startOfDay(now);
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const lastMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  const daysAgo = (days: number) => new Date(today.getTime() - days * DAY_MS);

  const [
    health,
    rows,
    days,
    [months],
    kinds,
    queries,
    hours,
    queues,
    [github],
    [people],
    pushes,
  ] = await Promise.all([
    readHealth(db, now),
    jobRows(db),
    db.$queryRaw<{ day: Date; bytes: bigint }[]>`
      SELECT "bucket" AS day, sum("total") AS bytes FROM "UsageStat"
      WHERE "metric" = 'db' AND "bucket" >= ${daysAgo(29)}
      GROUP BY "bucket" ORDER BY "bucket"`,
    db.$queryRaw<{ thisMonth: bigint | null; lastMonth: bigint | null }[]>`
      SELECT sum("total") FILTER (WHERE "bucket" >= ${monthStart}) AS "thisMonth",
        sum("total") FILTER (WHERE "bucket" < ${monthStart}) AS "lastMonth"
      FROM "UsageStat"
      WHERE "metric" = 'db' AND "bucket" >= ${lastMonthStart}`,
    db.$queryRaw<{ kind: string; bytes: bigint; queries: bigint }[]>`
      SELECT "key" AS kind, sum("total") AS bytes, sum("count") AS queries
      FROM "UsageStat"
      WHERE "metric" = 'db' AND "bucket" >= ${daysAgo(6)}
      GROUP BY "key" ORDER BY bytes DESC LIMIT ${TOP}`,
    topQueries(db),
    db.$queryRaw<{ hour: Date; jobs: bigint }[]>`
      SELECT "bucket" AS hour, sum("count") AS jobs FROM "UsageStat"
      WHERE "metric" = 'jobs' AND "bucket" > ${new Date(now.getTime() - DAY_MS)}
      GROUP BY "bucket" ORDER BY "bucket"`,
    db.$queryRaw<
      {
        queue: string;
        jobs: bigint | null;
        totalMs: bigint | null;
        slowestMs: bigint | null;
        failed: bigint | null;
      }[]
    >`
      SELECT "key" AS queue,
        sum("count") FILTER (WHERE "metric" = 'job') AS jobs,
        sum("total") FILTER (WHERE "metric" = 'job') AS "totalMs",
        max("high") FILTER (WHERE "metric" = 'job') AS "slowestMs",
        sum("count") FILTER (WHERE "metric" = 'job-failed') AS failed
      FROM "UsageStat"
      WHERE "metric" IN ('job', 'job-failed') AND "bucket" >= ${today}
      GROUP BY "key" ORDER BY jobs DESC NULLS LAST`,
    db.$queryRaw<
      {
        requests: bigint | null;
        syncRequests: bigint | null;
        lowestBudget: bigint | null;
        rateLimited: bigint | null;
      }[]
    >`
      SELECT sum("count") FILTER (WHERE "key" = 'requests') AS requests,
        sum("count") FILTER (WHERE "key" = 'requests' AND "source" = 'worker') AS "syncRequests",
        min("low") FILTER (WHERE "key" = 'budget') AS "lowestBudget",
        sum("count") FILTER (WHERE "key" = 'rate_limited') AS "rateLimited"
      FROM "UsageStat"
      WHERE "metric" = 'github' AND "bucket" >= ${today}`,
    db.$queryRaw<{ users: bigint; activeDay: bigint; activeWeek: bigint }[]>`
      SELECT count(*) AS users,
        count(*) FILTER (WHERE "lastActiveAt" > ${new Date(now.getTime() - DAY_MS)}) AS "activeDay",
        count(*) FILTER (WHERE "lastActiveAt" > ${new Date(now.getTime() - 7 * DAY_MS)}) AS "activeWeek"
      FROM "User"`,
    db.$queryRaw<{ day: Date; sent: bigint; failed: bigint }[]>`
      SELECT date_trunc('day', "sentAt") AS day,
        count(*) FILTER (WHERE "status" = 'sent') AS sent,
        count(*) FILTER (WHERE "status" = 'failed') AS failed
      FROM "NotificationLog"
      WHERE "sentAt" >= ${daysAgo(13)}
      GROUP BY 1 ORDER BY 1`,
  ]);

  return {
    at: iso(now),
    health: {
      dbBytes: health.dbBytes,
      jobRows: rows,
      syncingUsers: health.syncingUsers,
      lateUsers: health.lateUsers,
      failingUsers: health.failingUsers,
    },
    limits: {
      dbBytes: DB_LIMIT_MB * MB,
      dbWatchShare: DB_WARN_SHARE,
      egressBytesPerMonth: EGRESS_LIMIT_BYTES,
      egressWatchShare: EGRESS_WATCH_SHARE,
      jobRowsPerUser: JOB_ROWS_PER_USER,
      failingShare: FAILING_SHARE,
    },
    egress: {
      days: days.map((d) => ({ day: iso(d.day), bytes: num(d.bytes) })),
      thisMonth: num(months?.thisMonth),
      lastMonth: num(months?.lastMonth),
      kinds: kinds.map((k) => ({
        kind: k.kind,
        bytes: num(k.bytes),
        queries: num(k.queries),
      })),
    },
    queries,
    worker: {
      hours: hours.map((h) => ({ hour: iso(h.hour), jobs: num(h.jobs) })),
      queues: queues.map((q) => ({
        queue: q.queue,
        jobs: num(q.jobs),
        totalMs: num(q.totalMs),
        slowestMs: num(q.slowestMs),
        failed: num(q.failed),
      })),
    },
    github: {
      requests: num(github?.requests),
      syncRequests: num(github?.syncRequests),
      lowestBudget: numOrNull(github?.lowestBudget),
      rateLimited: num(github?.rateLimited),
    },
    people: {
      users: num(people?.users),
      activeDay: num(people?.activeDay),
      activeWeek: num(people?.activeWeek),
      pushes: pushes.map((p) => ({
        day: iso(p.day),
        sent: num(p.sent),
        failed: num(p.failed),
      })),
    },
  };
}
