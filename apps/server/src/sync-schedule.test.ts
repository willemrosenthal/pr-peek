import type { Octokit } from "octokit";
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
import { fakeGraphQL, type GraphQLRequest } from "../test/github";
import {
  githubPr,
  prGitHub,
  searchHit,
  type FakePrGitHub,
} from "../test/pulls";
import {
  encryptPersonalToken,
  NeedsReauthError,
  STOP_REASONS,
} from "./github/tokens";
import { createLogger } from "./logger";
import {
  backoffMs,
  dueUsers,
  isLagging,
  runSync,
  syncIntervalMs,
  type ScheduleUser,
} from "./sync-schedule";
import { upsertGitHubUser } from "./users";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const logger = createLogger({ LOG_LEVEL: "silent" });
const days = (n: number) => hours(n * 24);

async function makeUser(
  data: Parameters<typeof db.user.update>[0]["data"] = {},
) {
  const { user } = await upsertGitHubUser(
    db,
    githubUser(),
    githubTokens(),
    TEST_KEY,
  );
  await db.watchedRepo.create({
    data: { userId: user.id, githubRepoId: 1, owner: "acme", name: "web-app" },
  });
  return db.user.update({
    where: { id: user.id },
    data: { lastActiveAt: NOW, ...data },
  });
}

const reload = (id: string) => db.user.findUniqueOrThrow({ where: { id } });
const dueIds = async (at: Date) =>
  (await dueUsers(db, at)).map((user) => user.id);

describe("dueUsers", () => {
  it("includes users who never synced", async () => {
    const user = await makeUser();
    expect(await dueIds(NOW)).toEqual([user.id]);
  });

  it("syncs users using the app every 2 minutes", async () => {
    await makeUser({ lastSyncedAt: minutes(-1) });
    expect(await dueIds(NOW)).toEqual([]);

    // A little early still counts, so the once a minute dispatch doesn't skip a turn.
    await db.user.updateMany({ data: { lastSyncedAt: minutes(-1.5) } });
    expect(await dueIds(NOW)).toHaveLength(1);
  });

  it("counts from the start of the minute, however late the worker runs it", async () => {
    // Started right at the last dispatch. 30 seconds late, this one isn't due yet.
    await makeUser({ lastSyncedAt: minutes(-1) });
    expect(await dueIds(minutes(0.5))).toEqual([]);

    // Started 40 seconds after the dispatch before that. It's due, however late.
    await db.user.updateMany({ data: { lastSyncedAt: minutes(-2 + 40 / 60) } });
    expect(await dueIds(NOW)).toHaveLength(1);
    expect(await dueIds(minutes(0.5))).toHaveLength(1);
  });

  it("says how late each sync is, to spot a worker falling behind", async () => {
    await makeUser({ lastSyncedAt: minutes(-3) });
    const [onTime] = await dueUsers(db, NOW);
    expect(onTime).toMatchObject({ lateMs: 60_000 });
    expect(isLagging(onTime!)).toBe(false);

    await db.user.updateMany({ data: { lastSyncedAt: minutes(-5) } });
    const [late] = await dueUsers(db, NOW);
    expect(isLagging(late!)).toBe(true);
  });

  it("goes by the user's quiet hours and Mac app", async () => {
    const user = await makeUser({
      lastActiveAt: hours(-2),
      lastSyncedAt: minutes(-5),
    });
    await db.userSettings.update({
      where: { userId: user.id },
      data: { quietStart: "11:00", quietEnd: "13:00" },
    });
    // In quiet hours: every 15 minutes, even with the Mac app running.
    await db.user.updateMany({ data: { desktopSeenAt: minutes(-1) } });
    expect(await dueIds(NOW)).toEqual([]);

    // Out of quiet hours, with the Mac app running: every 2 minutes.
    await db.userSettings.updateMany({ data: { quietStart: null } });
    expect(await dueIds(NOW)).toEqual([user.id]);
  });

  it.each(STOP_REASONS)(
    "skips users stopped with %s until they fix it",
    async (syncError) => {
      await makeUser({ syncError });
      expect(await dueIds(NOW)).toEqual([]);
    },
  );

  it("waits until a failed user's retry time", async () => {
    await makeUser({ syncError: "failed", syncRetryAt: minutes(1) });
    expect(await dueIds(NOW)).toEqual([]);
    expect(await dueIds(minutes(1))).toHaveLength(1);
  });

  it("skips users with no enabled watched repos", async () => {
    await makeUser();
    await db.watchedRepo.updateMany({ data: { enabled: false } });
    expect(await dueIds(NOW)).toEqual([]);
  });
});

describe("syncIntervalMs", () => {
  const quiet = {
    timezone: "UTC",
    // Crosses midnight. NOW is 12:00 UTC, so it's quiet.
    quietStart: "22:00",
    quietEnd: "13:00",
    quietWeekends: false,
  };
  const user = (overrides: Partial<ScheduleUser>): ScheduleUser => ({
    lastActiveAt: hours(-2),
    desktopSeenAt: null,
    settings: null,
    ...overrides,
  });
  const everyMinutes = (u: ScheduleUser) => syncIntervalMs(u, NOW) / 60_000;

  it.each([
    ["used the app in the last hour", { lastActiveAt: minutes(-30) }, 2],
    [
      "used the app in the last hour, in quiet hours",
      { lastActiveAt: minutes(-30), settings: quiet },
      2,
    ],
    ["in quiet hours", { settings: quiet }, 15],
    [
      "in quiet hours, with the Mac app running",
      { settings: quiet, desktopSeenAt: minutes(-1) },
      15,
    ],
    ["with the Mac app running", { desktopSeenAt: minutes(-1) }, 2],
    [
      "away 14 days, with the Mac app running",
      { lastActiveAt: days(-15), desktopSeenAt: minutes(-1) },
      2,
    ],
    ["away 14 days", { lastActiveAt: days(-15) }, 30],
    ["after quiet hours end", { settings: { ...quiet, quietEnd: "11:00" } }, 5],
    ["anyone else", {}, 5],
  ] satisfies [string, Partial<ScheduleUser>, number][])(
    "syncs a user %s",
    (_name, overrides, expected) => {
      expect(everyMinutes(user(overrides))).toBe(expected);
    },
  );

  it("treats a Mac app that stopped sending heartbeats as closed", () => {
    expect(everyMinutes(user({ desktopSeenAt: minutes(-10) }))).toBe(5);
  });
});

describe("backoffMs", () => {
  it("doubles from 2 minutes up to 30", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffMs(n) / 60_000)).toEqual([
      2, 4, 8, 16, 30, 30,
    ]);
  });
});

describe("runSync", () => {
  // Runs one sync at NOW.
  const syncWith = (userId: string, github: () => Promise<Octokit>) =>
    runSync({ db, logger, github, now: () => NOW }, userId);

  // Runs one sync at NOW against a fake GitHub.
  const run = (userId: string, answer: (request: GraphQLRequest) => unknown) =>
    syncWith(userId, () => Promise.resolve(fakeGraphQL(answer).octokit));

  const rateLimitHeaders = (remaining: number, resetAt: Date) => ({
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-reset": String(resetAt.getTime() / 1000),
  });

  // GitHub's normal answer, with rate limit headers.
  const withPoints =
    (remaining: number, resetAt: Date) => (request: GraphQLRequest) =>
      Response.json(prGitHub({})(request), {
        headers: rateLimitHeaders(remaining, resetAt),
      });

  // Syncs the user at `now` against a fake GitHub, with queues that record what they get.
  function syncer(userId: string) {
    const queues = {
      notifyItems: vi.fn(() => Promise.resolve()),
      notifyMerged: vi.fn(() => Promise.resolve()),
    };
    const syncAt = (now: Date, fake: FakePrGitHub) =>
      runSync(
        {
          db,
          logger,
          github: () => Promise.resolve(fakeGraphQL(prGitHub(fake)).octokit),
          now: () => now,
          ...queues,
        },
        userId,
      );
    return { queues, syncAt };
  }
  const asked = {
    reviewRequested: [searchHit("PR_1")],
    prs: { PR_1: githubPr() },
  };

  it("queues notifications for new items", async () => {
    const user = await makeUser();
    const { queues, syncAt } = syncer(user.id);
    await syncAt(NOW, asked);
    const itemIds = (await db.item.findMany()).map((item) => item.id);
    // A review request, a reply, and a mention.
    expect(itemIds).toHaveLength(3);
    expect(queues.notifyItems).toHaveBeenCalledExactlyOnceWith(
      expect.arrayContaining(itemIds),
    );

    // Nothing new, so nothing to notify.
    await syncAt(minutes(1), asked);
    expect(queues.notifyItems).toHaveBeenCalledOnce();
  });

  it("queues a push for important PRs that merged", async () => {
    const user = await makeUser();
    const { queues, syncAt } = syncer(user.id);
    await syncAt(NOW, asked);
    await db.pullRequest.updateMany({ data: { importantAt: NOW } });
    expect(queues.notifyMerged).not.toHaveBeenCalled();

    await syncAt(minutes(1), {
      statuses: { PR_1: searchHit("PR_1", { state: "MERGED" }) },
    });
    const pr = await db.pullRequest.findFirstOrThrow();
    expect(queues.notifyMerged).toHaveBeenCalledExactlyOnceWith([pr.id]);
  });

  it("marks the sync as running until it ends, even when it fails", async () => {
    const user = await makeUser();
    let whileRunning: Date | null = null;
    await syncWith(user.id, async () => {
      whileRunning = (await reload(user.id)).syncStartedAt;
      throw new Error("GitHub is down");
    });

    expect(whileRunning).toEqual(NOW);
    expect((await reload(user.id)).syncStartedAt).toBeNull();
  });

  it("clears errors after a good sync", async () => {
    const user = await makeUser({
      syncError: "failed",
      syncFailures: 2,
      syncRetryAt: minutes(-1),
    });
    await run(user.id, prGitHub({}));

    expect(await reload(user.id)).toMatchObject({
      lastSyncedAt: NOW,
      syncError: null,
      syncFailures: 0,
      syncRetryAt: null,
      syncStartedAt: null,
    });
  });

  it("backs off after each failure", async () => {
    const user = await makeUser();
    const failing = () => Promise.reject(new Error("GitHub is down"));

    await syncWith(user.id, failing);
    expect(await reload(user.id)).toMatchObject({
      syncError: "failed",
      syncFailures: 1,
      syncRetryAt: minutes(2),
    });

    await syncWith(user.id, failing);
    expect(await reload(user.id)).toMatchObject({
      syncFailures: 2,
      syncRetryAt: minutes(4),
    });
  });

  it("stops without backing off when the user must sign in again", async () => {
    const user = await makeUser();
    await syncWith(user.id, () =>
      Promise.reject(new NeedsReauthError(user.id)),
    );

    expect(await reload(user.id)).toMatchObject({
      syncError: "reauth",
      syncFailures: 0,
      syncRetryAt: null,
      syncStartedAt: null,
    });
  });

  describe("when GitHub answers 401", () => {
    const badCredentials = () =>
      Response.json({ message: "Bad credentials" }, { status: 401 });

    it("asks the user to sign in again", async () => {
      const user = await makeUser();
      await run(user.id, badCredentials);

      expect(await reload(user.id)).toMatchObject({
        syncError: "reauth",
        syncFailures: 0,
        syncRetryAt: null,
      });
    });

    it("asks for a new token when the user added one", async () => {
      const user = await makeUser(
        encryptPersonalToken(
          { token: "ghp_token", expiresAt: null, scopes: ["repo"] },
          TEST_KEY,
        ),
      );
      await run(user.id, badCredentials);
      expect((await reload(user.id)).syncError).toBe("token");
    });
  });

  it("waits for the rate limit to reset when points run low", async () => {
    const user = await makeUser();
    await run(user.id, withPoints(100, minutes(20)));
    expect((await reload(user.id)).syncRetryAt).toEqual(minutes(20));

    await run(user.id, withPoints(4000, minutes(20)));
    expect((await reload(user.id)).syncRetryAt).toBeNull();
  });

  it("waits for the reset after hitting the rate limit", async () => {
    const user = await makeUser();
    await run(user.id, () =>
      Response.json(
        { message: "API rate limit exceeded" },
        { status: 403, headers: rateLimitHeaders(0, minutes(45)) },
      ),
    );

    expect(await reload(user.id)).toMatchObject({
      syncError: "failed",
      syncFailures: 1,
      syncRetryAt: minutes(45),
    });
  });
});
