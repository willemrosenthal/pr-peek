import pg from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, resetDb, TEST_DATABASE_URL } from "../test/db";
import { NOW } from "../test/fakes";
import { savedUsage } from "../test/usage";
import { createDb, createPool, type Db } from "./db";
import { createLogger } from "./logger";
import {
  countConnection,
  countJobs,
  countPool,
  MAX_ENTRIES,
  OTHER,
  queryKind,
  Usage,
} from "./usage";

const db = createTestDb();
const logger = createLogger({ LOG_LEVEL: "silent" });
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

// NOW is 12:00 UTC on 21 October 2026. The day and hour it falls in.
const DAY = new Date("2026-10-21T00:00:00Z");
const HOUR = new Date("2026-10-21T12:00:00Z");
const usageAt = (now = NOW) => new Usage("web", () => now);

describe("Usage", () => {
  it("saves counts per day, adding them up", async () => {
    const usage = usageAt();
    usage.add("github", "requests");
    usage.add("github", "requests", { count: 2 });
    usage.add("db", "connect", { total: 100 });

    expect(await savedUsage(db, usage)).toEqual([
      {
        bucket: DAY,
        source: "web",
        metric: "db",
        key: "connect",
        count: 1,
        total: 100,
        low: null,
        high: null,
      },
      {
        bucket: DAY,
        source: "web",
        metric: "github",
        key: "requests",
        count: 3,
        total: 0,
        low: null,
        high: null,
      },
    ]);
  });

  it("adds a second save to the first, keeping the lowest and highest", async () => {
    const usage = usageAt();
    usage.add("job", "sync-user", { total: 500, low: 40, high: 500 });
    await usage.save(db);
    usage.add("job", "sync-user", { total: 900, low: 60, high: 900 });

    const [row] = await savedUsage(db, usage);
    expect(row).toMatchObject({ count: 2, total: 1400, low: 40, high: 900 });
  });

  it("keeps hourly counts by the hour", async () => {
    const usage = usageAt(new Date("2026-10-21T12:34:56Z"));
    usage.add("jobs", "all", {}, "hour");

    const [row] = await savedUsage(db, usage);
    expect(row?.bucket).toEqual(HOUR);
  });

  it("saves nothing when there's nothing to save", async () => {
    const executeRaw = vi.fn();
    await usageAt().save({ $executeRaw: executeRaw } as unknown as Db);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it(`puts keys past ${MAX_ENTRIES} under "${OTHER}"`, async () => {
    const usage = usageAt();
    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      usage.add("db", `query ${i}`, { total: 10 });
    }

    const rows = await savedUsage(db, usage);
    expect(rows).toHaveLength(MAX_ENTRIES + 1);
    expect(rows.find((row) => row.key === OTHER)).toMatchObject({
      count: 5,
      total: 50,
    });
  });

  it("saves what's left when stopped, for shutdown", async () => {
    const usage = usageAt();
    const stop = usage.saveHourly(db, logger);
    usage.add("github", "requests");

    await stop();
    expect(await db.usageStat.count()).toBe(1);
  });

  it("keeps the counts of a failed save for the next one", async () => {
    const usage = usageAt();
    usage.add("github", "requests");
    const failing = {
      $executeRaw: vi.fn(() => Promise.reject(new Error("db down"))),
    } as unknown as Db;
    await expect(usage.save(failing)).rejects.toThrow("db down");
    usage.add("github", "requests");

    const [row] = await savedUsage(db, usage);
    expect(row).toMatchObject({ bucket: DAY, count: 2 });
  });
});

describe("queryKind", () => {
  it.each([
    [
      'SELECT "id" FROM "public"."PullRequest" WHERE "userId" = $1',
      "PullRequest select",
    ],
    [
      "UPDATE pgboss.job SET state = 'active' WHERE id = $1",
      "pgboss.job update",
    ],
    ['INSERT INTO "session" (sid) VALUES ($1)', "session insert"],
    [
      "WITH next AS (SELECT id FROM pgboss.job) UPDATE pgboss.job SET x = 1",
      "pgboss.job with",
    ],
    ["BEGIN", "begin"],
    ["select 1", "select"],
  ])("names %s as %s", (sql, kind) => {
    expect(queryKind(sql)).toBe(kind);
  });
});

describe("counting database bytes", () => {
  // A pool of its own, so its connections open after counting starts.
  function setup() {
    const usage = usageAt();
    const pool = createPool({
      DATABASE_URL: TEST_DATABASE_URL,
      DB_POOL_MAX: 2,
    });
    countPool(pool, usage);
    const counted = createDb(pool);
    const bytes = async () =>
      Object.fromEntries(
        (await savedUsage(db, usage))
          .filter((row) => row.metric === "db")
          .map((row) => [row.key, row.total]),
      );
    const close = async () => {
      await counted.$disconnect();
      await pool.end();
    };
    return { pool, counted, bytes, close };
  }

  it("counts each query's bytes by its kind, through Prisma and the pool", async () => {
    const { pool, counted, bytes, close } = setup();
    try {
      await counted.user.findMany();
      await pool.query("SELECT repeat('x', 100000)");
      const totals = await bytes();

      expect(totals["connect"]).toBeGreaterThan(0);
      expect(totals["User select"]).toBeGreaterThan(0);
      // The string, plus a little for the message around it.
      expect(totals["select"]).toBeGreaterThanOrEqual(100_000);
      expect(totals["select"]).toBeLessThan(101_000);
    } finally {
      await close();
    }
  });

  it("counts LISTEN messages as notify", async () => {
    const usage = usageAt();
    const listener = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await listener.connect();
    try {
      countConnection(listener, usage);
      await listener.query("LISTEN usage_test");
      const heard = new Promise((resolve) =>
        listener.once("notification", resolve),
      );
      await db.$executeRaw`SELECT pg_notify('usage_test', repeat('x', 5000))`;
      await heard;

      const notify = (await savedUsage(db, usage)).find(
        (row) => row.key === "notify",
      );
      expect(notify?.total).toBeGreaterThanOrEqual(5000);
    } finally {
      await listener.end();
    }
  });
});

describe("countJobs", () => {
  it("counts each job per queue with its time, and all jobs per hour", async () => {
    let now = NOW.getTime();
    const usage = new Usage("worker", () => new Date(now));
    const work = countJobs(usage, "sync-user", () => {
      now += 250;
      return Promise.resolve();
    });

    await work([]);
    await work([]);
    const rows = await savedUsage(db, usage);
    expect(
      rows.map(({ metric, key, count, total, high }) => ({
        metric,
        key,
        count,
        total,
        high,
      })),
    ).toEqual([
      { metric: "job", key: "sync-user", count: 2, total: 500, high: 250 },
      { metric: "jobs", key: "all", count: 2, total: 0, high: null },
    ]);
  });

  it("counts a failed job, and still fails it", async () => {
    const usage = usageAt();
    const work = countJobs(usage, "notify-items", () =>
      Promise.reject(new Error("push down")),
    );

    await expect(work([])).rejects.toThrow("push down");
    const keys = (await savedUsage(db, usage)).map(
      ({ metric, key }) => `${metric} ${key}`,
    );
    expect(keys).toEqual([
      "job notify-items",
      "job-failed notify-items",
      "jobs all",
    ]);
  });
});
