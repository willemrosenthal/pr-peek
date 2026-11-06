import type {
  AdminOverviewResponse,
  MeResponse,
  TestAlertResponse,
} from "@pr-peek/core";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_URL, bodyOf, makeTestApp, signIn } from "../../test/app";
import { createTestDb, resetDb } from "../../test/db";
import {
  githubTokens,
  githubUser,
  hours,
  NOW,
  TEST_KEY,
} from "../../test/fakes";
import { itemRows } from "../../test/items";
import { createLogger } from "../logger";
import type { SendPush } from "../push";
import { upsertGitHubUser } from "../users";
import { adminRouter } from "./admin";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const logger = createLogger({ LOG_LEVEL: "silent" });
const { makePr, makeItem } = itemRows(db);
const DAY = 24 * 60 * 60 * 1000;
// NOW is 12:00 UTC on 21 October 2026.
const day = (date: string) => new Date(`${date}T00:00:00Z`);

async function setup({ admin = true, send = null as SendPush | null } = {}) {
  const { agent } = makeTestApp(db, {
    routers: [adminRouter({ db, logger, send, now: () => NOW })],
  });
  await signIn(agent);
  const me = await db.user.findFirstOrThrow();
  if (admin) {
    await db.user.update({ where: { id: me.id }, data: { role: "admin" } });
  }
  const overview = async () =>
    bodyOf<AdminOverviewResponse>(await agent.get("/api/admin/overview"));
  return { agent, me, overview };
}

// A usage row, like the hourly save makes.
const stat = (
  bucket: Date,
  metric: string,
  key: string,
  values: { count?: number; total?: number; low?: number; high?: number } = {},
  source = "web",
) => ({
  bucket,
  source,
  metric,
  key,
  count: BigInt(values.count ?? 1),
  total: BigInt(values.total ?? 0),
  low: values.low === undefined ? null : BigInt(values.low),
  high: values.high === undefined ? null : BigInt(values.high),
});

describe("who can see it", () => {
  it("answers 404 to someone who isn't an admin", async () => {
    const { agent } = await setup({ admin: false });
    expect((await agent.get("/api/admin/overview")).status).toBe(404);
    expect(
      (await agent.post("/api/admin/test-alert").set("Origin", APP_URL)).status,
    ).toBe(404);
  });

  it("needs signing in", async () => {
    const { agent } = makeTestApp(db, {
      routers: [adminRouter({ db, logger, send: null })],
    });
    expect((await agent.get("/api/admin/overview")).status).toBe(401);
  });

  it.each([
    [true, "an admin"],
    [false, "anyone else"],
  ])("says isAdmin %s for %s in /api/me", async (admin) => {
    const { agent } = await setup({ admin });
    expect(bodyOf<MeResponse>(await agent.get("/api/me")).isAdmin).toBe(admin);
  });
});

describe("GET /api/admin/overview", () => {
  it("adds up egress per day and per month, and the kinds of read", async () => {
    const { overview } = await setup();
    await db.usageStat.createMany({
      data: [
        // Today, from both processes, so they add up.
        stat(day("2026-10-21"), "db", "PullRequest select", {
          count: 10,
          total: 3000,
        }),
        stat(
          day("2026-10-21"),
          "db",
          "PullRequest select",
          { count: 5, total: 1000 },
          "worker",
        ),
        stat(day("2026-10-20"), "db", "Item select", { count: 2, total: 500 }),
        // Last month: in its total, but past the 30 days.
        stat(day("2026-09-10"), "db", "Item select", { total: 9000 }),
        // Before last month: in nothing.
        stat(day("2026-08-10"), "db", "Item select", { total: 7 }),
        // Not egress.
        stat(day("2026-10-21"), "github", "requests", { count: 4 }),
      ],
    });

    const { egress } = await overview();
    expect(egress).toEqual({
      days: [
        { day: "2026-10-20T00:00:00.000Z", bytes: 500 },
        { day: "2026-10-21T00:00:00.000Z", bytes: 4000 },
      ],
      thisMonth: 4500,
      lastMonth: 9000,
      kinds: [
        { kind: "PullRequest select", bytes: 4000, queries: 15 },
        { kind: "Item select", bytes: 500, queries: 2 },
      ],
    });
  });

  it("shows the worker's jobs today and per hour, and GitHub requests today", async () => {
    const { overview } = await setup();
    const hour = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);
    await db.usageStat.createMany({
      data: [
        stat(hour(0), "jobs", "all", { count: 30 }, "worker"),
        stat(hour(5), "jobs", "all", { count: 20 }, "worker"),
        // Over a day ago.
        stat(hour(25), "jobs", "all", { count: 99 }, "worker"),
        stat(
          day("2026-10-21"),
          "job",
          "sync-user",
          { count: 4, total: 2000, high: 900 },
          "worker",
        ),
        stat(
          day("2026-10-21"),
          "job-failed",
          "sync-user",
          { count: 1 },
          "worker",
        ),
        stat(
          day("2026-10-21"),
          "job",
          "heartbeat",
          { count: 9, total: 18, high: 3 },
          "worker",
        ),
        // Yesterday.
        stat(day("2026-10-20"), "job", "sync-user", { count: 50 }, "worker"),
        stat(day("2026-10-21"), "github", "requests", { count: 6 }, "worker"),
        stat(day("2026-10-21"), "github", "requests", { count: 2 }),
        stat(day("2026-10-21"), "github", "budget", { low: 4800 }, "worker"),
        stat(day("2026-10-21"), "github", "budget", { low: 4500 }),
        stat(day("2026-10-21"), "github", "rate_limited", { count: 1 }),
      ],
    });

    const { worker, github } = await overview();
    expect(worker).toEqual({
      hours: [
        { hour: hour(5).toISOString(), jobs: 20 },
        { hour: hour(0).toISOString(), jobs: 30 },
      ],
      queues: [
        { queue: "heartbeat", jobs: 9, totalMs: 18, slowestMs: 3, failed: 0 },
        {
          queue: "sync-user",
          jobs: 4,
          totalMs: 2000,
          slowestMs: 900,
          failed: 1,
        },
      ],
    });
    expect(github).toEqual({ requests: 8, lowestBudget: 4500, rateLimited: 1 });
  });

  it("counts people, and pushes per day", async () => {
    const { me, overview } = await setup();
    for (const [login, daysAway] of [
      ["away-3-days", 3],
      ["away-10-days", 10],
    ] as const) {
      const { user } = await upsertGitHubUser(
        db,
        githubUser({ id: 100 + daysAway, login }),
        githubTokens(),
        TEST_KEY,
      );
      await db.user.update({
        where: { id: user.id },
        data: { lastActiveAt: new Date(NOW.getTime() - daysAway * DAY) },
      });
    }
    await db.user.update({ where: { id: me.id }, data: { lastActiveAt: NOW } });
    const pr = await makePr(me.id);
    const item = await makeItem(me.id, pr.id, "review_requested");
    const log = (eventId: string, sentAt: Date, status: "sent" | "failed") =>
      db.notificationLog.create({
        data: {
          userId: me.id,
          itemId: item.id,
          eventId,
          channel: "push",
          sentAt,
          status,
        },
      });
    await log("E_1", hours(-1), "sent");
    await log("E_2", hours(-2), "sent");
    await log("E_3", hours(-26), "failed");
    // Past the 14 days.
    await log("E_4", new Date(NOW.getTime() - 20 * DAY), "sent");

    expect((await overview()).people).toEqual({
      users: 3,
      activeDay: 1,
      activeWeek: 2,
      pushes: [
        { day: "2026-10-20T00:00:00.000Z", sent: 0, failed: 1 },
        { day: "2026-10-21T00:00:00.000Z", sent: 2, failed: 0 },
      ],
    });
  });

  it("gives the health numbers, and the limits to read them by", async () => {
    const { overview } = await setup();
    const { health, limits } = await overview();

    expect(health.dbBytes).toBeGreaterThan(0);
    expect(health).toMatchObject({
      syncingUsers: 0,
      lateUsers: 0,
      failingUsers: 0,
    });
    expect(limits).toEqual({
      dbBytes: 500 * 1024 * 1024,
      dbWatchShare: 0.7,
      egressBytesPerMonth: 5 * 1024 * 1024 * 1024,
      egressWatchShare: 0.8,
      jobRowsPerUser: 60,
      failingShare: 0.25,
    });
  });

  it("stays small with 30 days of many kinds of read", async () => {
    const { agent } = await setup();
    const data = [];
    for (let d = 0; d < 30; d++) {
      for (let k = 0; k < 200; k++) {
        data.push(
          stat(
            new Date(day("2026-10-21").getTime() - d * DAY),
            "db",
            `${"x".repeat(60)} ${k}`,
            {
              total: 1000 + k,
            },
          ),
        );
      }
    }
    await db.usageStat.createMany({ data });

    const res = await agent.get("/api/admin/overview");
    const { egress } = bodyOf<AdminOverviewResponse>(res);
    expect(egress.days).toHaveLength(30);
    expect(egress.kinds).toHaveLength(8);
    expect(res.text.length).toBeLessThan(50_000);
  });
});

describe("POST /api/admin/test-alert", () => {
  it("pushes to the admin's own devices", async () => {
    const send = vi.fn<SendPush>(() => Promise.resolve());
    const { agent, me } = await setup({ send });
    await db.pushSubscription.create({
      data: {
        userId: me.id,
        endpoint: "https://push.example/phone",
        p256dh: "key",
        auth: "auth",
      },
    });

    const res = await agent
      .post("/api/admin/test-alert")
      .set("Origin", APP_URL);
    expect(bodyOf<TestAlertResponse>(res)).toEqual({ sent: true });
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ endpoint: "https://push.example/phone" }),
      expect.objectContaining({ tag: "alert-test", url: "/admin" }),
      expect.anything(),
    );
  });

  it("says so when the admin has no devices", async () => {
    const { agent } = await setup({ send: vi.fn<SendPush>() });
    const res = await agent
      .post("/api/admin/test-alert")
      .set("Origin", APP_URL);
    expect(bodyOf<TestAlertResponse>(res)).toEqual({ sent: false });
  });

  it("answers 503 when push is off", async () => {
    const { agent } = await setup();
    const res = await agent
      .post("/api/admin/test-alert")
      .set("Origin", APP_URL);
    expect(res.status).toBe(503);
  });
});
