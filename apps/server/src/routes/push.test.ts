import {
  MAX_PUSH_DEVICES,
  PUSH_KINDS,
  type AppleDeviceResponse,
  type AppleTestResponse,
  type PushSubscriptionResponse,
  type PushSubscriptionsResponse,
} from "@pr-peek/core";
import type { Response } from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_URL,
  bodyOf,
  makeTestApp,
  signIn,
  type Agent,
} from "../../test/app";
import { createTestDb, resetDb } from "../../test/db";
import type { SendApple } from "../apns";
import { createLogger } from "../logger";
import { pushRouter } from "./push";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const logger = createLogger({ LOG_LEVEL: "silent" });
const PUBLIC_KEY = "the-public-key";
const keys = {
  p256dh:
    "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
  auth: "tBHItJI5svbpez7KI4CCXg",
};
const endpoint = (name = "phone") =>
  `https://fcm.googleapis.com/fcm/send/${name}`;

async function setup(
  options: { pushOn?: boolean; apple?: SendApple | null } = {},
) {
  const push = options.pushOn === false ? null : { publicKey: PUBLIC_KEY };
  const apple = options.apple ?? null;
  const { agent } = makeTestApp(db, {
    routers: [pushRouter({ db, push, apple, logger })],
  });
  await signIn(agent);
  return { agent };
}

const subscribe = (agent: Agent, body: object = {}) =>
  agent
    .post("/api/push/subscriptions")
    .set("Origin", APP_URL)
    .send({ endpoint: endpoint(), keys, label: "iPhone", ...body });

const deviceOf = (res: Response) =>
  bodyOf<PushSubscriptionResponse>(res).subscription;

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
      lastSuccessAt: null,
    });
  });

  it("updates the keys of a device it already has, keeping the rest", async () => {
    const { agent } = await setup();
    const { id } = deviceOf(await subscribe(agent, { label: "My phone" }));

    const res = await subscribe(agent, {
      label: "Another name",
      keys: { ...keys, auth: "new-auth-key" },
    });
    expect(res.status).toBe(200);
    expect(deviceOf(res)).toMatchObject({ id, label: "My phone" });
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
      },
    });

    const res = await subscribe(agent);
    expect(res.status).toBe(201);
    expect(deviceOf(res).label).toBe("iPhone");
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

  it("refuses a change with nothing it can change, like the old name or level", async () => {
    const { agent } = await setup();
    const { id } = deviceOf(await subscribe(agent));
    const res = await agent
      .patch(`/api/push/subscriptions/${id}`)
      .set("Origin", APP_URL)
      .send({ label: "Work phone", minSeverity: "high" });
    expect(res.status).toBe(400);
  });

  it("moves a device to the browser's new subscription, keeping its settings", async () => {
    const { agent } = await setup();
    const { id } = deviceOf(await subscribe(agent));
    await db.pushSubscription.update({
      where: { id },
      data: { failureCount: 2 },
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
      .send({ onMac: true });
    const del = await agent
      .delete(`/api/push/subscriptions/${id}`)
      .set("Origin", APP_URL);
    expect([patch.status, del.status]).toEqual([404, 404]);
  });
});

describe("the iPhone app's devices", () => {
  const TOKEN = "ab".repeat(32);
  const register = (agent: Agent, body: object = {}) =>
    agent
      .post("/api/apple-devices")
      .set("Origin", APP_URL)
      .send({ token: TOKEN, label: "iPhone", sandbox: false, ...body });
  const saved = () => db.appleDevice.findUnique({ where: { token: TOKEN } });

  it("adds the phone, then updates it", async () => {
    const { agent } = await setup();
    const res = await register(agent, { token: TOKEN.toUpperCase() });
    expect(res.status).toBe(201);
    expect(bodyOf<AppleDeviceResponse>(res).device.label).toBe("iPhone");

    const again = await register(agent, {
      label: "Kim's phone",
      sandbox: true,
    });
    expect(again.status).toBe(200);
    expect(await saved()).toMatchObject({
      label: "Kim's phone",
      sandbox: true,
    });
    expect(await db.appleDevice.count()).toBe(1);
  });

  it("moves the phone to whoever signed in on it last, starting over", async () => {
    const { agent } = await setup();
    const other = await db.user.create({
      data: { githubId: 99, login: "sam" },
    });
    await db.appleDevice.create({
      data: {
        userId: other.id,
        token: TOKEN,
        lastSuccessAt: new Date(),
        failureCount: 2,
      },
    });

    expect((await register(agent)).status).toBe(201);
    expect(await saved()).toMatchObject({
      userId: (await db.user.findFirstOrThrow({ where: { login: "octocat" } }))
        .id,
      lastSuccessAt: null,
      failureCount: 0,
    });
  });

  it("refuses a token that isn't one", async () => {
    const { agent } = await setup();
    expect((await register(agent, { token: "not-hex" })).status).toBe(400);
  });

  it(`stops at ${MAX_PUSH_DEVICES} phones`, async () => {
    const { agent } = await setup();
    const user = await db.user.findFirstOrThrow();
    await db.appleDevice.createMany({
      data: Array.from({ length: MAX_PUSH_DEVICES }, (_, i) => ({
        userId: user.id,
        token: String(i).repeat(64),
      })),
    });
    const res = await register(agent);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: "too_many_devices" } });
    expect((await register(agent, { token: "0".repeat(64) })).status).toBe(200);
  });

  it("removes only the user's own phone", async () => {
    const { agent } = await setup();
    const other = await db.user.create({
      data: { githubId: 99, login: "sam" },
    });
    await db.appleDevice.create({
      data: { userId: other.id, token: "cd".repeat(32) },
    });
    await register(agent);

    const remove = (token: string) =>
      agent.delete(`/api/apple-devices/${token}`).set("Origin", APP_URL);
    expect((await remove("cd".repeat(32))).status).toBe(404);
    expect((await remove(TOKEN.toUpperCase())).status).toBe(204);
    expect(await saved()).toBeNull();
    expect(await db.appleDevice.count()).toBe(1);
  });
});

describe("Send a test", () => {
  const PHONE = "ab".repeat(32);
  const OTHER_PHONE = "cd".repeat(32);

  async function withPhones(apple = vi.fn<SendApple>(() => Promise.resolve())) {
    const { agent } = await setup({ apple });
    const user = await db.user.findFirstOrThrow();
    await db.appleDevice.createMany({
      data: [PHONE, OTHER_PHONE].map((token) => ({ userId: user.id, token })),
    });
    const test = () =>
      agent.post("/api/apple-devices/test").set("Origin", APP_URL);
    return { apple, test };
  }

  it("sends one of each kind to each phone, with the user's own picture", async () => {
    const { apple, test } = await withPhones();
    const res = await test();
    expect(bodyOf<AppleTestResponse>(res)).toEqual({ sent: 2, failed: 0 });

    const toPhone = apple.mock.calls.filter(
      ([target]) => target.token === PHONE,
    );
    const payloads = toPhone.map(([, payload]) => payload);
    // Each kind, then a plain one like the morning summary.
    expect(payloads.map((p) => p.kind)).toEqual([...PUSH_KINDS, undefined]);
    const byKind = new Map(payloads.map((p) => [p.kind, p]));
    expect(byKind.get("approved")).toMatchObject({
      title: "octocat approved",
      actor: "octocat",
    });
    // Like the real ones, these show no person.
    expect(byKind.get("check_failed")).not.toHaveProperty("actor");
    expect(byKind.get("merged")).not.toHaveProperty("actor");
  });

  it("stops at a phone's first failure, so it counts once", async () => {
    const apple = vi.fn<SendApple>((target) =>
      target.token === OTHER_PHONE
        ? Promise.reject(new Error("network down"))
        : Promise.resolve(),
    );
    const { test } = await withPhones(apple);
    expect(bodyOf<AppleTestResponse>(await test())).toEqual({
      sent: 1,
      failed: 1,
    });
    const tries = apple.mock.calls.filter(([t]) => t.token === OTHER_PHONE);
    expect(tries).toHaveLength(1);
    expect(
      await db.appleDevice.findUniqueOrThrow({ where: { token: OTHER_PHONE } }),
    ).toMatchObject({ failureCount: 1 });
  });

  it("says when there's no phone, or Apple push isn't set up", async () => {
    const { agent } = await setup({ apple: vi.fn<SendApple>() });
    const test = () =>
      agent.post("/api/apple-devices/test").set("Origin", APP_URL);
    expect((await test()).status).toBe(404);

    const off = await setup();
    const res = await off.agent
      .post("/api/apple-devices/test")
      .set("Origin", APP_URL);
    expect(res.status).toBe(503);
  });
});

it("needs sign in for devices", async () => {
  const { agent } = makeTestApp(db, {
    routers: [pushRouter({ db, push: null, apple: null, logger })],
  });
  expect((await agent.get("/api/push/subscriptions")).status).toBe(401);
  expect(
    (await agent.post("/api/apple-devices").set("Origin", APP_URL).send({}))
      .status,
  ).toBe(401);
});
