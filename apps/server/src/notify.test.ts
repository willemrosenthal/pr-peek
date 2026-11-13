import {
  githubAvatarUrl,
  type PushPayload,
  type Severity,
} from "@pr-peek/core";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { createTestDb, resetDb } from "../test/db";
import { desktopNotifications } from "../test/desktop";
import { githubTokens, githubUser, hours, NOW, TEST_KEY } from "../test/fakes";
import { itemRows } from "../test/items";
import { createLogger } from "./logger";
import { BATCH_MIN, notifyItem, notifyItems, notifyMerged } from "./notify";
import type { SendApple } from "./apns";
import { PUSH_AVATAR_PX, type SendPush } from "./push";
import { upsertGitHubUser } from "./users";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const logger = createLogger({ LOG_LEVEL: "silent" });
const { makePr, makeItem } = itemRows(db);
const keys = { p256dh: "p256dh-key", auth: "auth-key" };
const endpoint = (name: string) =>
  `https://fcm.googleapis.com/fcm/send/${name}`;

// A user with a review request whose rule notifies at `severity`, and one device.
async function setup({ severity = "normal" }: { severity?: Severity } = {}) {
  const { user } = await upsertGitHubUser(
    db,
    githubUser(),
    githubTokens(),
    TEST_KEY,
  );
  await db.ruleSetting.update({
    where: { userId_ruleId: { userId: user.id, ruleId: "review_requested" } },
    data: { severity, channels: ["list", "push"] },
  });
  const pr = await makePr(user.id);
  const item = await makeItem(user.id, pr.id, "review_requested");
  await addDevice(user.id, "phone");
  const send = vi.fn<SendPush>(() => Promise.resolve());
  const notify = (now = NOW) =>
    notifyItem({ db, send, logger, now: () => now }, item.id);
  return { user, item, send, notify };
}

const addDevice = (userId: string, name: string) =>
  db.pushSubscription.create({
    data: { userId, endpoint: endpoint(name), ...keys },
  });

// NOW is 12:00 UTC, so these quiet hours cover it.
const QUIET_NOW = { quietStart: "11:00", quietEnd: "13:00" };

const sentTo = (send: ReturnType<typeof vi.fn<SendPush>>) =>
  send.mock.calls.map(([target]) => target.endpoint);

describe("notifyItem", () => {
  it("sends the item to the user's devices and logs it", async () => {
    const { item, send, notify } = await setup();

    expect(await notify()).toBe("sent");
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ endpoint: endpoint("phone") }),
      {
        title: "review_requested summary",
        body: "Add login\nweb-app #7",
        url: "https://github.com/acme/web-app/pull/7",
        prId: item.pullRequestId,
        tag: item.id,
        itemId: item.id,
        badge: 1,
        kind: "review_requested",
      } satisfies PushPayload,
      { ttlSeconds: 12 * 60 * 60, urgency: "normal" },
    );
    expect(await db.notificationLog.findFirstOrThrow()).toMatchObject({
      itemId: item.id,
      eventId: "E_1",
      channel: "push",
      status: "sent",
    });
  });

  it.each([
    [
      "a person's change request: its tile, the person, and their picture",
      { actorLogin: "maya", reviewState: "changes_requested" },
      {
        kind: "changes_requested",
        actor: "maya",
        avatar: githubAvatarUrl("maya", PUSH_AVATAR_PX),
      },
    ],
    [
      "a bot's review: its tile, and nobody",
      { actorLogin: "ci[bot]", actorIsBot: true, reviewState: "approved" },
      { kind: "approved" },
    ],
  ])("tells the iPhone app %s", async (_name, fields, expected) => {
    const { user, send } = await setup();
    await db.item.deleteMany();
    const pr = await db.pullRequest.findFirstOrThrow();
    const item = await makeItem(user.id, pr.id, "reviewed", fields);

    await notifyItem({ db, send, logger, now: () => NOW }, item.id);
    const payload = send.mock.calls[0]?.[1];
    expect(payload).toMatchObject(expected);
    if (!("actor" in expected)) expect(payload).not.toHaveProperty("actor");
  });

  it("sends once per event, even when run again", async () => {
    const { item, send, notify } = await setup();
    await notify();
    expect(await notify()).toBe("already_sent");
    expect(send).toHaveBeenCalledOnce();

    // A new event on the same item notifies again.
    await db.item.update({
      where: { id: item.id },
      data: { latestEventId: "E_2" },
    });
    expect(await notify()).toBe("sent");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends once when two runs race", async () => {
    const { send, notify } = await setup();
    const outcomes = await Promise.all([notify(), notify()]);
    expect(outcomes.sort()).toEqual(["already_sent", "sent"]);
    expect(send).toHaveBeenCalledOnce();
  });

  it("sends to each of the user's devices", async () => {
    const { user, send, notify } = await setup();
    await addDevice(user.id, "mac");

    await notify();
    expect(sentTo(send).sort()).toEqual([endpoint("mac"), endpoint("phone")]);
  });

  it("sends high severity as urgent", async () => {
    const { send, notify } = await setup({ severity: "high" });
    await notify();
    expect(send.mock.calls[0]?.[2].urgency).toBe("high");
  });

  it("logs a failure when no device got it", async () => {
    const { send, notify } = await setup();
    send.mockRejectedValue(
      new webpush.WebPushError("gone", 410, {}, "", endpoint("phone")),
    );

    expect(await notify()).toBe("failed");
    expect((await db.notificationLog.findFirstOrThrow()).status).toBe("failed");
    expect(await db.pushSubscription.count()).toBe(0);
  });

  describe("skips, without logging", () => {
    it.each([
      ["resolved", { status: "resolved" as const }, "not_open"],
      ["seen", { seenAt: NOW }, "seen"],
    ])("a %s item", async (_name, data, outcome) => {
      const { item, send, notify } = await setup();
      await db.item.update({ where: { id: item.id }, data });
      expect(await notify()).toBe(outcome);
      expect(send).not.toHaveBeenCalled();
      expect(await db.notificationLog.count()).toBe(0);
    });

    it.each([
      ["turned off", { enabled: false }],
      ["not set to notify", { channels: ["list" as const] }],
    ])("a rule %s", async (_name, data) => {
      const { user, send, notify } = await setup();
      await db.ruleSetting.update({
        where: {
          userId_ruleId: { userId: user.id, ruleId: "review_requested" },
        },
        data,
      });
      expect(await notify()).toBe("rule_off");
      expect(send).not.toHaveBeenCalled();
    });

    it("a muted repo", async () => {
      const { user, send, notify } = await setup();
      await db.watchedRepo.create({
        data: {
          userId: user.id,
          githubRepoId: 1,
          owner: "acme",
          name: "web-app",
          muted: true,
        },
      });
      expect(await notify()).toBe("muted");
      expect(send).not.toHaveBeenCalled();
    });

    it("no devices", async () => {
      const { send, notify } = await setup();
      await db.pushSubscription.deleteMany();
      expect(await notify()).toBe("no_devices");
      expect(send).not.toHaveBeenCalled();
      expect(await db.notificationLog.count()).toBe(0);
    });

    it("push being off", async () => {
      const { item } = await setup();
      expect(await notifyItem({ db, send: null, logger }, item.id)).toBe(
        "push_off",
      );
    });
  });

  it("sends to the iPhone app when it's the only device", async () => {
    const { user, item, send } = await setup();
    await db.pushSubscription.deleteMany();
    await db.appleDevice.create({
      data: { userId: user.id, token: "ab".repeat(32) },
    });
    const apple = vi.fn<SendApple>(() => Promise.resolve());

    expect(
      await notifyItem({ db, send, apple, logger, now: () => NOW }, item.id),
    ).toBe("sent");
    expect(apple).toHaveBeenCalledOnce();
    expect((await db.notificationLog.findFirstOrThrow()).status).toBe("sent");
    // Without Apple push set up, the phone doesn't count.
    await db.notificationLog.deleteMany();
    expect(
      await notifyItem({ db, send, logger, now: () => NOW }, item.id),
    ).toBe("no_devices");
  });

  describe("quiet hours", () => {
    it.each<[Severity, boolean, string]>([
      ["normal", false, "quiet"],
      ["high", false, "quiet"],
      ["normal", true, "quiet"],
      ["high", true, "sent"],
    ])(
      "%s severity, high lets through: %s",
      async (severity, highBreaksQuiet, outcome) => {
        const { user, notify } = await setup({ severity });
        await db.userSettings.update({
          where: { userId: user.id },
          data: { ...QUIET_NOW, highBreaksQuiet },
        });
        expect(await notify()).toBe(outcome);
      },
    );
  });
});

describe("while the Mac menu bar app runs", () => {
  // The setup, with a browser on the Mac too, and the app's last heartbeat at `seenAt`.
  async function withDesktop(seenAt: Date) {
    const ctx = await setup();
    await db.pushSubscription.create({
      data: {
        userId: ctx.user.id,
        endpoint: endpoint("mac"),
        ...keys,
        onMac: true,
      },
    });
    await db.user.update({
      where: { id: ctx.user.id },
      data: { desktopSeenAt: seenAt },
    });
    return { ...ctx, toApp: await desktopNotifications(ctx.user.id) };
  }

  it("sends to the app instead of the browsers on the Mac", async () => {
    const { send, notify, toApp } = await withDesktop(hours(-0.02));

    expect(await notify()).toBe("sent");
    expect(sentTo(send)).toEqual([endpoint("phone")]);
    await vi.waitFor(() => expect(toApp).toHaveLength(1));
    expect(toApp[0]?.payload.title).toBe("review_requested summary");
  });

  it("sends to the app even with no browser devices", async () => {
    const { send, notify, toApp } = await withDesktop(hours(-0.02));
    await db.pushSubscription.deleteMany();

    expect(await notify()).toBe("sent");
    expect(send).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(toApp).toHaveLength(1));
  });

  it("goes back to the browsers a few minutes after the last heartbeat", async () => {
    const { send, notify, toApp } = await withDesktop(hours(-0.1));
    expect(await notify()).toBe("sent");
    expect(sentTo(send).sort()).toEqual([endpoint("mac"), endpoint("phone")]);
    await new Promise((done) => setTimeout(done, 100));
    expect(toApp).toEqual([]);
  });
});

describe("notifyItems", () => {
  // The setup user with `count` review requests in all, one per PR.
  async function withRequests(count: number) {
    const ctx = await setup();
    const ids = [ctx.item.id];
    for (let number = 8; ids.length < count; number++) {
      const pr = await makePr(ctx.user.id, number);
      ids.push((await makeItem(ctx.user.id, pr.id, "review_requested")).id);
    }
    const notifyAll = () =>
      notifyItems(
        { db, send: ctx.send, logger, now: () => NOW },
        ids.map((itemId) => ({ itemId })),
      );
    return { ...ctx, ids, notifyAll };
  }

  it(`sends ${BATCH_MIN} or more as one push that opens the list`, async () => {
    const { send, notifyAll } = await withRequests(5);

    expect(await notifyAll()).toEqual(Array(5).fill("sent"));
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ endpoint: endpoint("phone") }),
      {
        title: "5 things need you",
        body: [
          ...Array<string>(3).fill("review_requested summary"),
          "+2 more",
        ].join("\n"),
        url: "/",
        tag: "batch",
        badge: 5,
      } satisfies PushPayload,
      { ttlSeconds: 12 * 60 * 60, urgency: "normal" },
    );
    const logs = await db.notificationLog.findMany();
    expect(logs.map((log) => log.status)).toEqual(Array(5).fill("sent"));
  });

  it(`sends fewer than ${BATCH_MIN} one at a time`, async () => {
    const { ids, send, notifyAll } = await withRequests(2);
    await notifyAll();
    // Each push is tagged with its own item.
    expect(send.mock.calls.map(([, payload]) => payload.tag)).toEqual(ids);
  });

  it("only batches the ones that pass every check", async () => {
    const { item, send, notifyAll } = await withRequests(3);
    await db.item.update({ where: { id: item.id }, data: { seenAt: NOW } });

    expect(await notifyAll()).toEqual(["seen", "sent", "sent"]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends a batch to each device, urgent if any is high", async () => {
    const { user, ids, send } = await withRequests(3);
    await addDevice(user.id, "watch");
    await db.ruleSetting.update({
      where: { userId_ruleId: { userId: user.id, ruleId: "reply" } },
      data: { severity: "high", channels: ["list", "push"] },
    });
    const pr = await makePr(user.id, 20);
    const reply = await makeItem(user.id, pr.id, "reply");

    await notifyItems(
      { db, send, logger, now: () => NOW },
      [...ids, reply.id].map((itemId) => ({ itemId })),
    );
    expect(sentTo(send).sort()).toEqual([endpoint("phone"), endpoint("watch")]);
    expect(send.mock.calls.map(([, , options]) => options.urgency)).toEqual([
      "high",
      "high",
    ]);
  });

  it("sends a batch once", async () => {
    const { send, notifyAll } = await withRequests(3);
    await notifyAll();
    expect(await notifyAll()).toEqual(Array(3).fill("already_sent"));
    expect(send).toHaveBeenCalledOnce();
  });
});

describe("notifyMerged", () => {
  // A user with a merged PR marked important, and a device.
  async function merged() {
    const { user } = await upsertGitHubUser(
      db,
      githubUser(),
      githubTokens(),
      TEST_KEY,
    );
    const pr = await makePr(user.id, 7, {
      state: "merged",
      importantAt: hours(-1),
      mergedAt: NOW,
    });
    await addDevice(user.id, "watch");
    const send = vi.fn<SendPush>(() => Promise.resolve());
    const notify = () =>
      notifyMerged({ db, send, logger, now: () => NOW }, [pr.id]);
    return { user, pr, send, notify };
  }

  it("sends a high severity push that opens the PR", async () => {
    const { pr, send, notify } = await merged();

    expect(await notify()).toEqual(["sent"]);
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ endpoint: endpoint("watch") }),
      {
        title: "Important PR merged",
        body: "Add login\nweb-app #7",
        url: "https://github.com/acme/web-app/pull/7",
        prId: pr.id,
        tag: `merged:${pr.id}`,
        badge: 0,
        kind: "merged",
      } satisfies PushPayload,
      { ttlSeconds: 12 * 60 * 60, urgency: "high" },
    );
  });

  it("sends once, even when run again", async () => {
    const { send, notify } = await merged();
    await notify();
    expect(await notify()).toEqual(["already_sent"]);
    expect(send).toHaveBeenCalledOnce();
  });

  it("skips a PR that's no longer important", async () => {
    const { pr, send, notify } = await merged();
    await db.pullRequest.update({
      where: { id: pr.id },
      data: { importantAt: null },
    });
    expect(await notify()).toEqual(["not_important"]);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips quiet hours, unless high lets through", async () => {
    const { user, send, notify } = await merged();
    await db.userSettings.update({
      where: { userId: user.id },
      data: QUIET_NOW,
    });
    expect(await notify()).toEqual(["quiet"]);

    await db.userSettings.update({
      where: { userId: user.id },
      data: { highBreaksQuiet: true },
    });
    expect(await notify()).toEqual(["sent"]);
    expect(send).toHaveBeenCalledOnce();
  });

  it("skips a muted repo", async () => {
    const { user, notify } = await merged();
    await db.watchedRepo.create({
      data: {
        userId: user.id,
        githubRepoId: 1,
        owner: "acme",
        name: "web-app",
        muted: true,
      },
    });
    expect(await notify()).toEqual(["muted"]);
  });
});
