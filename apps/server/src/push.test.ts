import type { PushPayload } from "@pr-peek/core";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { createTestDb, resetDb } from "../test/db";
import { ApnsError, type SendApple } from "./apns";
import { createLogger } from "./logger";
import {
  deliver,
  MAX_PUSH_FAILURES,
  pushToDevice,
  type SendPush,
} from "./push";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const logger = createLogger({ LOG_LEVEL: "silent" });
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/phone";
const PAYLOAD: PushPayload = { title: "Hi", body: "There", url: "/", tag: "t" };
const OPTIONS = { ttlSeconds: 60, urgency: "normal" as const };

async function setup() {
  const user = await db.user.create({ data: { githubId: 1, login: "kim" } });
  const device = await db.pushSubscription.create({
    data: { userId: user.id, endpoint: ENDPOINT, p256dh: "p", auth: "a" },
  });
  const send = vi.fn<SendPush>(() => Promise.resolve());
  // Reads the device again each time, like a real sender would.
  const push = async () =>
    pushToDevice(
      { db, send, logger },
      await db.pushSubscription.findUniqueOrThrow({ where: { id: device.id } }),
      PAYLOAD,
      OPTIONS,
    );
  return { device, send, push };
}

const saved = (id: string) => db.pushSubscription.findUnique({ where: { id } });

const pushError = (status: number) =>
  new webpush.WebPushError("refused", status, {}, "", ENDPOINT);

describe("pushToDevice", () => {
  it("sends and records the success", async () => {
    const { device, send, push } = await setup();
    expect(await push()).toBe("sent");
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ endpoint: ENDPOINT }),
      PAYLOAD,
      OPTIONS,
    );
    expect((await saved(device.id))?.lastSuccessAt).not.toBeNull();
  });

  it.each([404, 410])(
    "removes the device when the push service answers %i",
    async (status) => {
      const { device, send, push } = await setup();
      send.mockRejectedValue(pushError(status));
      expect(await push()).toBe("removed");
      expect(await saved(device.id)).toBeNull();
    },
  );

  it(`counts other failures, and removes the device after ${MAX_PUSH_FAILURES} in a row`, async () => {
    const { device, send, push } = await setup();
    send.mockRejectedValue(pushError(500));

    for (let i = 1; i < MAX_PUSH_FAILURES; i++) {
      expect(await push()).toBe("failed");
    }
    expect((await saved(device.id))?.failureCount).toBe(MAX_PUSH_FAILURES - 1);
    expect(await push()).toBe("removed");
    expect(await saved(device.id)).toBeNull();
  });

  it("starts the failure count over after a success", async () => {
    const { device, send, push } = await setup();
    send.mockRejectedValueOnce(new Error("network down"));
    await push();

    expect(await push()).toBe("sent");
    expect((await saved(device.id))?.failureCount).toBe(0);
  });
});

describe("deliver", () => {
  const NOW = new Date("2026-11-11T12:00:00Z");
  const IPHONE = "https://web.push.apple.com/phone";
  const MAC = "https://web.push.apple.com/mac";
  const TOKEN = "ab".repeat(32);

  async function setupDelivery() {
    const user = await db.user.create({ data: { githubId: 1, login: "kim" } });
    const browser = (endpoint: string, onMac: boolean | null) =>
      db.pushSubscription.create({
        data: { userId: user.id, endpoint, p256dh: "p", auth: "a", onMac },
      });
    await browser(ENDPOINT, null);
    await browser(IPHONE, false);
    await browser(MAC, true);
    const send = vi.fn<SendPush>(() => Promise.resolve());
    const apple = vi.fn<SendApple>(() => Promise.resolve());
    const run = async (withApple: SendApple | null = apple) =>
      deliver(
        { db, send, apple: withApple, logger },
        user,
        await db.pushSubscription.findMany({ where: { userId: user.id } }),
        PAYLOAD,
        { ...OPTIONS, now: NOW },
      );
    const addPhone = () =>
      db.appleDevice.create({
        data: { userId: user.id, token: TOKEN, sandbox: true },
      });
    const sentTo = () => send.mock.calls.map(([device]) => device.endpoint);
    return { send, apple, run, addPhone, sentTo };
  }

  it("sends to every browser when there's no iPhone app", async () => {
    const { apple, run, sentTo } = await setupDelivery();
    expect(await run()).toBe("sent");
    expect(sentTo().sort()).toEqual([ENDPOINT, IPHONE, MAC].sort());
    expect(apple).not.toHaveBeenCalled();
  });

  it("sends to the iPhone app instead of the web app on the iPhone", async () => {
    const { apple, run, addPhone, sentTo } = await setupDelivery();
    await addPhone();
    expect(await run()).toBe("sent");
    // The Mac's Safari also uses Apple's push service, but it's not a phone.
    expect(sentTo().sort()).toEqual([ENDPOINT, MAC].sort());
    expect(apple).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ token: TOKEN, sandbox: true }),
      PAYLOAD,
      OPTIONS,
    );
  });

  it("keeps the web app on the iPhone when Apple push isn't set up", async () => {
    const { run, addPhone, sentTo } = await setupDelivery();
    await addPhone();
    await run(null);
    expect(sentTo()).toContain(IPHONE);
  });

  it("removes an iPhone app Apple says is gone, and counts other failures", async () => {
    const { apple, run, addPhone } = await setupDelivery();
    const phone = await addPhone();
    apple.mockRejectedValueOnce(new ApnsError(500, "InternalServerError"));
    await run();
    expect(
      (await db.appleDevice.findUnique({ where: { id: phone.id } }))
        ?.failureCount,
    ).toBe(1);

    apple.mockRejectedValueOnce(new ApnsError(410, "Unregistered"));
    await run();
    expect(await db.appleDevice.findUnique({ where: { id: phone.id } })).toBe(
      null,
    );
  });

  it("is sent when only the iPhone app got it", async () => {
    const { send, run, addPhone } = await setupDelivery();
    await addPhone();
    send.mockRejectedValue(pushError(500));
    expect(await run()).toBe("sent");
  });
});
