import type { PushPayload } from "@pr-peek/core";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { createTestDb, resetDb } from "../test/db";
import { createLogger } from "./logger";
import { MAX_PUSH_FAILURES, pushToDevice, type SendPush } from "./push";

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
