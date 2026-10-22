import type { PushPayload, Severity } from "@pr-peek/core";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { createTestDb, resetDb } from "../test/db";
import { githubTokens, githubUser, NOW, TEST_KEY } from "../test/fakes";
import { itemRows } from "../test/items";
import { createLogger } from "./logger";
import { BATCH_MIN, notifyItem, notifyItems } from "./notify";
import type { SendPush } from "./push";
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
  await addDevice(user.id, "phone", "low");
  const send = vi.fn<SendPush>(() => Promise.resolve());
  const notify = (now = NOW) =>
    notifyItem({ db, send, logger, now: () => now }, item.id);
  return { user, item, send, notify };
}

const addDevice = (userId: string, name: string, minSeverity: Severity) =>
  db.pushSubscription.create({
    data: { userId, endpoint: endpoint(name), ...keys, minSeverity },
  });

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
        tag: item.id,
        itemId: item.id,
        badge: 1,
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

  it("sends only to devices that take the rule's severity", async () => {
    const { user, send, notify } = await setup({ severity: "normal" });
    await addDevice(user.id, "mac", "normal");
    await addDevice(user.id, "watch", "high");

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

    it("no device that takes the severity", async () => {
      const { send, notify } = await setup({ severity: "low" });
      await db.pushSubscription.updateMany({ data: { minSeverity: "normal" } });
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

  describe("quiet hours", () => {
    // NOW is 12:00 UTC, so these quiet hours cover it.
    const quietNow = { quietStart: "11:00", quietEnd: "13:00" };

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
          data: { ...quietNow, highBreaksQuiet },
        });
        expect(await notify()).toBe(outcome);
      },
    );
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

  it("sends a batch to each device that takes any of it, urgent if any is high", async () => {
    const { user, ids, send } = await withRequests(3);
    await addDevice(user.id, "watch", "high");
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
