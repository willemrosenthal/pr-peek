import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, resetDb } from "../test/db";
import {
  githubTokens,
  githubUser,
  hours,
  minutes,
  NOW,
  TEST_KEY,
} from "../test/fakes";
import {
  alertsFor,
  checkHealth,
  readHealth,
  USAGE_KEPT_DAYS,
  type Health,
} from "./health";
import { createLogger } from "./logger";
import type { SendPush } from "./push";
import { upsertGitHubUser } from "./users";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const logger = createLogger({ LOG_LEVEL: "silent" });
const MB = 1024 * 1024;
const PHONE = "https://fcm.googleapis.com/fcm/send/phone";

let nextId = 1;
async function makeUser(
  login: string,
  data: Parameters<typeof db.user.update>[0]["data"] = {},
  { syncs = true } = {},
) {
  const { user } = await upsertGitHubUser(
    db,
    githubUser({ id: nextId++, login }),
    githubTokens(),
    TEST_KEY,
  );
  if (syncs) {
    await db.watchedRepo.create({
      data: { userId: user.id, githubRepoId: 1, owner: "acme", name: "app" },
    });
  }
  return db.user.update({
    where: { id: user.id },
    data: { lastActiveAt: NOW, lastSyncedAt: NOW, ...data },
  });
}

// Backing off, so not due while the tests move time on.
const failing = {
  syncError: "failed",
  syncFailures: 3,
  syncRetryAt: hours(48),
} as const;
const failedOnce = { ...failing, syncFailures: 1 };

describe("readHealth", () => {
  it("counts the users who sync, are late, and keep failing", async () => {
    await makeUser("late", { lastSyncedAt: minutes(-30) });
    await makeUser("failing", failing);
    await makeUser("failed-once", failedOnce);
    await makeUser("stopped", { syncError: "reauth" });
    await makeUser("no-repos", {}, { syncs: false });

    const health = await readHealth(db, NOW);

    expect(health).toMatchObject({
      lateUsers: 1,
      syncingUsers: 3,
      failingUsers: 1,
    });
    expect(health.dbBytes).toBeGreaterThan(0);
  });
});

describe("alertsFor", () => {
  const fine: Health = {
    dbBytes: 49 * MB,
    lateUsers: 0,
    syncingUsers: 4,
    failingUsers: 1,
  };
  const kinds = (health: Partial<Health>) =>
    alertsFor({ ...fine, ...health }).map((alert) => alert.kind);

  it("finds nothing when all is fine", () => {
    expect(kinds({})).toEqual([]);
  });

  it("alerts past each limit", () => {
    expect(kinds({ dbBytes: 6 * 1024 * MB })).toEqual(["database"]);
    expect(kinds({ lateUsers: 1 })).toEqual(["late"]);
    expect(kinds({ failingUsers: 2 })).toEqual(["failing"]);
  });

  it("says one user, not one users", () => {
    expect(alertsFor({ ...fine, lateUsers: 1 })[0]?.body).toBe(
      "Syncs are falling behind: 1 user 15 minutes or more late. Raise SYNC_CONCURRENCY.",
    );
  });

  it("says the numbers", () => {
    expect(alertsFor({ ...fine, dbBytes: 6 * 1024 * MB })[0]?.body).toBe(
      "The database is at 6.0 GB of the 8 GB in Supabase Pro.",
    );
  });
});

describe("checkHealth", () => {
  const PHONE_2 = "https://fcm.googleapis.com/fcm/send/phone-2";

  // An admin with one device, and two users who sync: one keeps failing. Neither is
  // due, so time can move on without them falling behind.
  async function setup() {
    const admin = await makeUser("admin", { role: "admin" }, { syncs: false });
    await db.pushSubscription.create({
      data: { userId: admin.id, endpoint: PHONE, p256dh: "key", auth: "auth" },
    });
    await makeUser("failed-once", failedOnce);
    await makeUser("failing", failing);
    const send = vi.fn<SendPush>(() => Promise.resolve());
    const run = (now = NOW) => checkHealth({ db, send, logger }, now);
    return { admin, send, run };
  }

  // A second admin, with their own device.
  async function addAdmin() {
    const admin = await makeUser(
      "admin-2",
      { role: "admin" },
      { syncs: false },
    );
    await db.pushSubscription.create({
      data: {
        userId: admin.id,
        endpoint: PHONE_2,
        p256dh: "key",
        auth: "auth",
      },
    });
    return admin;
  }

  const sentTo = (send: ReturnType<typeof vi.fn<SendPush>>) =>
    send.mock.calls.map(([device]) => device.endpoint);

  const quiet = (userId: string) =>
    db.userSettings.update({
      where: { userId },
      data: { quietStart: "11:00", quietEnd: "13:00" },
    });

  it("pushes each alert to the admin, once a day", async () => {
    const { send, run } = await setup();

    expect(await run()).toEqual(["failing"]);
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ endpoint: PHONE }),
      {
        title: "Git Buddy needs a look",
        body: "Syncs keep failing for 1 of 2 users. Check the worker logs.",
        url: "/",
        tag: "alert-failing",
      },
      { ttlSeconds: 12 * 60 * 60, urgency: "normal" },
    );

    expect(await run(hours(1))).toEqual([]);
    expect(await run(hours(24))).toEqual(["failing"]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keeps the once a day apart for each kind of alert", async () => {
    const { run } = await setup();
    expect(await run()).toEqual(["failing"]);

    // An hour on, a sync falls behind too. Only the new kind goes out.
    await makeUser("late", { lastSyncedAt: minutes(-20) });
    expect(await run(hours(1))).toEqual(["late"]);
  });

  it("pushes to every admin", async () => {
    const { send, run } = await setup();
    await addAdmin();

    expect(await run()).toEqual(["failing"]);
    expect(sentTo(send).sort()).toEqual([PHONE, PHONE_2]);
  });

  it("skips an admin in their quiet hours when another is awake", async () => {
    const { admin, send, run } = await setup();
    await addAdmin();
    await quiet(admin.id);

    expect(await run()).toEqual(["failing"]);
    expect(sentTo(send)).toEqual([PHONE_2]);
  });

  it("waits while every admin is in their quiet hours", async () => {
    const { admin, run } = await setup();
    await quiet(admin.id);

    expect(await run()).toEqual([]);
    expect(await run(hours(1))).toEqual(["failing"]);
  });

  it("only logs when nobody is an admin", async () => {
    const { admin, send, run } = await setup();
    await db.user.update({ where: { id: admin.id }, data: { role: "user" } });

    expect(await run()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it(`deletes usage counts older than ${USAGE_KEPT_DAYS} days`, async () => {
    const { run } = await setup();
    const daysAgo = (days: number) =>
      new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
    const row = (bucket: Date) => ({
      bucket,
      source: "web",
      metric: "db",
      key: "connect",
    });
    await db.usageStat.createMany({
      data: [
        row(daysAgo(USAGE_KEPT_DAYS + 1)),
        row(daysAgo(USAGE_KEPT_DAYS - 1)),
      ],
    });

    await run();
    const kept = await db.usageStat.findMany({ select: { bucket: true } });
    expect(kept).toEqual([{ bucket: daysAgo(USAGE_KEPT_DAYS - 1) }]);
  });
});
