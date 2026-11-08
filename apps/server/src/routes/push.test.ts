import {
  MAX_PUSH_DEVICES,
  TEST_PUSHES,
  type PushSubscriptionResponse,
  type PushSubscriptionsResponse,
} from "@pr-peek/core";
import type { Response } from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import {
  APP_URL,
  bodyOf,
  makeTestApp,
  signIn,
  type Agent,
} from "../../test/app";
import { createTestDb, resetDb } from "../../test/db";
import { MAX_PUSH_FAILURES, type SendPush } from "../push";
import { pushRouter, TEST_PUSHES_PER_MINUTE } from "./push";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const PUBLIC_KEY = "the-public-key";
const keys = {
  p256dh:
    "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
  auth: "tBHItJI5svbpez7KI4CCXg",
};
const endpoint = (name = "phone") =>
  `https://fcm.googleapis.com/fcm/send/${name}`;

async function setup(options: { pushOn?: boolean } = {}) {
  const send = vi.fn<SendPush>(() => Promise.resolve());
  const push =
    options.pushOn === false ? null : { publicKey: PUBLIC_KEY, send };
  const { agent } = makeTestApp(db, { routers: [pushRouter({ db, push })] });
  await signIn(agent);
  return { agent, send };
}

const subscribe = (agent: Agent, body: object = {}) =>
  agent
    .post("/api/push/subscriptions")
    .set("Origin", APP_URL)
    .send({ endpoint: endpoint(), keys, label: "iPhone", ...body });

const deviceOf = (res: Response) =>
  bodyOf<PushSubscriptionResponse>(res).subscription;

const sendTest = (agent: Agent, id: string, body: object = {}) =>
  agent
    .post(`/api/push/subscriptions/${id}/test`)
    .set("Origin", APP_URL)
    .send(body);

const pushError = (status: number) =>
  new webpush.WebPushError("refused", status, {}, "", endpoint());

describe("GET /api/push/key", () => {
  it("gives the public key", async () => {
    const { agent } = await setup();
    const res = await agent.get("/api/push/key");
    expect(res.body).toEqual({ publicKey: PUBLIC_KEY });
  });

  it("says push is off when the keys aren't set", async () => {
    const { agent } = await setup({ pushOn: false });
    const res = await agent.get("/api/push/key");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: { code: "push_off" } });
  });
});

describe("POST /api/push/subscriptions", () => {
  it("adds a device", async () => {
    const { agent } = await setup();
    const res = await subscribe(agent);
    expect(res.status).toBe(201);
    expect(deviceOf(res)).toMatchObject({
      endpoint: endpoint(),
      label: "iPhone",
      minSeverity: "low",
      lastSuccessAt: null,
    });
  });

  it("updates the keys of a device it already has, keeping its settings", async () => {
    const { agent } = await setup();
    const { id } = deviceOf(await subscribe(agent));
    await agent
      .patch(`/api/push/subscriptions/${id}`)
      .set("Origin", APP_URL)
      .send({ label: "My phone", minSeverity: "high" });

    const res = await subscribe(agent, {
      keys: { ...keys, auth: "new-auth-key" },
    });
    expect(res.status).toBe(200);
    expect(deviceOf(res)).toMatchObject({
      id,
      label: "My phone",
      minSeverity: "high",
    });
    const saved = await db.pushSubscription.findUniqueOrThrow({
      where: { id },
    });
    expect(saved.auth).toBe("new-auth-key");
  });

  it("moves a device to whoever signed in on it last, starting over", async () => {
    const { agent } = await setup();
    const other = await db.user.create({
      data: { githubId: 99, login: "sam" },
    });
    await db.pushSubscription.create({
      data: {
        userId: other.id,
        endpoint: endpoint(),
        ...keys,
        label: "Sam's phone",
        minSeverity: "high",
      },
    });

    const res = await subscribe(agent);
    expect(res.status).toBe(201);
    expect(deviceOf(res)).toMatchObject({
      label: "iPhone",
      minSeverity: "low",
    });
    const saved = await db.pushSubscription.findUniqueOrThrow({
      where: { endpoint: endpoint() },
      include: { user: true },
    });
    expect(saved.user.login).toBe("octocat");
  });

  it("saves whether the browser is on a Mac, and leaves it when not sent", async () => {
    const { agent } = await setup();
    await subscribe(agent, { onMac: true });
    await subscribe(agent);
    const saved = await db.pushSubscription.findUniqueOrThrow({
      where: { endpoint: endpoint() },
    });
    expect(saved.onMac).toBe(true);

    await agent
      .patch(`/api/push/subscriptions/${saved.id}`)
      .set("Origin", APP_URL)
      .send({ onMac: false });
    const updated = await db.pushSubscription.findUniqueOrThrow({
      where: { id: saved.id },
    });
    expect(updated.onMac).toBe(false);
  });

  it("refuses an endpoint that isn't a push service", async () => {
    const { agent } = await setup();
    const res = await subscribe(agent, { endpoint: "https://localhost/push" });
    expect(res.status).toBe(400);
  });

  it(`stops at ${MAX_PUSH_DEVICES} devices`, async () => {
    const { agent } = await setup();
    const user = await db.user.findFirstOrThrow();
    await db.pushSubscription.createMany({
      data: Array.from({ length: MAX_PUSH_DEVICES }, (_, i) => ({
        userId: user.id,
        endpoint: endpoint(`device-${i}`),
        ...keys,
      })),
    });

    const res = await subscribe(agent);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: "too_many_devices" } });
    // One already saved still updates.
    expect(
      (await subscribe(agent, { endpoint: endpoint("device-0") })).status,
    ).toBe(200);
  });
});

describe("listing, changing, and removing devices", () => {
  it("lists only the user's devices", async () => {
    const { agent } = await setup();
    await subscribe(agent);
    const other = await db.user.create({
      data: { githubId: 99, login: "sam" },
    });
    await db.pushSubscription.create({
      data: { userId: other.id, endpoint: endpoint("sam"), ...keys },
    });

    const res = await agent.get("/api/push/subscriptions");
    const { subscriptions } = bodyOf<PushSubscriptionsResponse>(res);
    expect(subscriptions.map((s) => s.label)).toEqual(["iPhone"]);
  });

  it("rejects a severity that doesn't exist", async () => {
    const { agent } = await setup();
    const { id } = deviceOf(await subscribe(agent));
    const res = await agent
      .patch(`/api/push/subscriptions/${id}`)
      .set("Origin", APP_URL)
      .send({ minSeverity: "urgent" });
    expect(res.status).toBe(400);
  });

  it("moves a device to the browser's new subscription, keeping its settings", async () => {
    const { agent } = await setup();
    const { id } = deviceOf(await subscribe(agent));
    await db.pushSubscription.update({
      where: { id },
      data: { minSeverity: "high", failureCount: 2 },
    });

    const res = await agent
      .patch(`/api/push/subscriptions/${id}`)
      .set("Origin", APP_URL)
      .send({
        subscription: {
          endpoint: endpoint("renewed"),
          keys: { ...keys, auth: "new-auth-key" },
        },
      });
    expect(deviceOf(res)).toMatchObject({
      id,
      endpoint: endpoint("renewed"),
      label: "iPhone",
      minSeverity: "high",
    });
    const saved = await db.pushSubscription.findUniqueOrThrow({
      where: { id },
    });
    expect(saved).toMatchObject({ auth: "new-auth-key", failureCount: 0 });
  });

  it("won't move a device onto another device's subscription", async () => {
    const { agent } = await setup();
    const { id } = deviceOf(await subscribe(agent));
    await subscribe(agent, { endpoint: endpoint("mac") });

    const res = await agent
      .patch(`/api/push/subscriptions/${id}`)
      .set("Origin", APP_URL)
      .send({ subscription: { endpoint: endpoint("mac"), keys } });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: "device_exists" } });
  });

  it("removes a device", async () => {
    const { agent } = await setup();
    const { id } = deviceOf(await subscribe(agent));
    const res = await agent
      .delete(`/api/push/subscriptions/${id}`)
      .set("Origin", APP_URL);
    expect(res.status).toBe(204);
    expect(await db.pushSubscription.count()).toBe(0);
  });

  it("can't touch another user's device", async () => {
    const { agent } = await setup();
    const other = await db.user.create({
      data: { githubId: 99, login: "sam" },
    });
    const { id } = await db.pushSubscription.create({
      data: { userId: other.id, endpoint: endpoint("sam"), ...keys },
    });

    const patch = await agent
      .patch(`/api/push/subscriptions/${id}`)
      .set("Origin", APP_URL)
      .send({ label: "Mine now" });
    const del = await agent
      .delete(`/api/push/subscriptions/${id}`)
      .set("Origin", APP_URL);
    expect([
      patch.status,
      del.status,
      (await sendTest(agent, id)).status,
    ]).toEqual([404, 404, 404]);
  });
});

describe("POST /api/push/subscriptions/:id/test", () => {
  it("sends a test push and records the success", async () => {
    const { agent, send } = await setup();
    const { id } = deviceOf(await subscribe(agent));

    const res = await sendTest(agent, id);
    expect(res.status).toBe(200);
    expect(deviceOf(res).lastSuccessAt).not.toBeNull();
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ endpoint: endpoint(), ...keys }),
      TEST_PUSHES[0]!.payload,
      { ttlSeconds: 60, urgency: "high" },
    );
  });

  it("sends the test it's asked for", async () => {
    const { agent, send } = await setup();
    const { id } = deviceOf(await subscribe(agent));

    expect((await sendTest(agent, id, { sample: 2 })).status).toBe(200);
    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: "priya-das approved",
        tag: "test-2",
        icon: "https://github.com/identicons/priya-das.png",
      }),
      expect.anything(),
    );
  });

  it(`allows ${TEST_PUSHES_PER_MINUTE} tests a minute`, async () => {
    const { agent, send } = await setup();
    const { id } = deviceOf(await subscribe(agent));
    for (let i = 0; i < TEST_PUSHES_PER_MINUTE; i++) await sendTest(agent, id);

    const res = await sendTest(agent, id);
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: { code: "rate_limited" } });
    expect(send).toHaveBeenCalledTimes(TEST_PUSHES_PER_MINUTE);
  });

  it.each([-1, TEST_PUSHES.length, 1.5, "2"])(
    "refuses a test that doesn't exist: %s",
    async (sample) => {
      const { agent, send } = await setup();
      const { id } = deviceOf(await subscribe(agent));

      expect((await sendTest(agent, id, { sample })).status).toBe(400);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([404, 410])(
    "removes the device when the push service answers %i",
    async (status) => {
      const { agent, send } = await setup();
      const { id } = deviceOf(await subscribe(agent));
      send.mockRejectedValue(pushError(status));

      const res = await sendTest(agent, id);
      expect(res.status).toBe(410);
      expect(res.body).toMatchObject({ error: { code: "device_gone" } });
      expect(await db.pushSubscription.count()).toBe(0);
    },
  );

  it(`counts other failures, and removes the device after ${MAX_PUSH_FAILURES} in a row`, async () => {
    const { agent, send } = await setup();
    const { id } = deviceOf(await subscribe(agent));
    send.mockRejectedValue(pushError(500));

    for (let i = 1; i < MAX_PUSH_FAILURES; i++) {
      expect((await sendTest(agent, id)).status).toBe(502);
    }
    const device = await db.pushSubscription.findUniqueOrThrow({
      where: { id },
    });
    expect(device.failureCount).toBe(MAX_PUSH_FAILURES - 1);

    const last = await sendTest(agent, id);
    expect(last.status).toBe(410);
    expect(await db.pushSubscription.count()).toBe(0);
  });

  it("starts the failure count over after a success", async () => {
    const { agent, send } = await setup();
    const { id } = deviceOf(await subscribe(agent));
    send.mockRejectedValueOnce(new Error("network down"));
    await sendTest(agent, id);

    await sendTest(agent, id);
    const device = await db.pushSubscription.findUniqueOrThrow({
      where: { id },
    });
    expect(device.failureCount).toBe(0);
  });

  it("says push is off when the keys aren't set", async () => {
    const { agent } = await setup({ pushOn: false });
    const { id } = deviceOf(await subscribe(agent));
    expect((await sendTest(agent, id)).status).toBe(503);
  });
});

it("needs sign in for devices", async () => {
  const { agent } = makeTestApp(db, {
    routers: [pushRouter({ db, push: null })],
  });
  expect((await agent.get("/api/push/subscriptions")).status).toBe(401);
});
