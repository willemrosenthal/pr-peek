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
import { alertsFor, checkHealth, readHealth, type Health } from "./health";
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
    expect(kinds({ dbBytes: 360 * MB })).toEqual(["database"]);
    expect(kinds({ lateUsers: 1 })).toEqual(["late"]);
    expect(kinds({ failingUsers: 2 })).toEqual(["failing"]);
  });

  it("says one user, not one users", () => {
    expect(alertsFor({ ...fine, lateUsers: 1 })[0]?.body).toBe(
      "Syncs are falling behind: 1 user 15 minutes or more late. Raise SYNC_CONCURRENCY.",
    );
  });

  it("says the numbers", () => {
    expect(alertsFor({ ...fine, dbBytes: 360 * MB })[0]?.body).toBe(
      "The database is at 360 MB of the free plan's 500 MB.",
    );
  });
});

describe("checkHealth", () => {
  // The admin, with one device, and two users who sync: one keeps failing.
  // Neither is due, so time can move on without them falling behind.
  async function setup() {
    const admin = await makeUser("Admin", {}, { syncs: false });
    await db.pushSubscription.create({
      data: { userId: admin.id, endpoint: PHONE, p256dh: "key", auth: "auth" },
    });
    await makeUser("failed-once", failedOnce);
    await makeUser("failing", failing);
    const send = vi.fn<SendPush>(() => Promise.resolve());
    // As the admin, named in other letters, since logins ignore case.
    const run = (now = NOW) =>
      checkHealth({ db, send, logger, adminLogin: "ADMIN" }, now);
    const runAs = (adminLogin: string | undefined) =>
      checkHealth({ db, send, logger, adminLogin }, NOW);
    return { admin, send, run, runAs };
  }

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

  it("waits out the admin's quiet hours", async () => {
    const { admin, run } = await setup();
    await db.userSettings.update({
      where: { userId: admin.id },
      data: { quietStart: "11:00", quietEnd: "13:00" },
    });

    expect(await run()).toEqual([]);
    expect(await run(hours(1))).toEqual(["failing"]);
  });

  it("only logs without an admin, or one who isn't a user", async () => {
    const { send, runAs } = await setup();

    expect(await runAs(undefined)).toEqual([]);
    expect(await runAs("someone-else")).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});
