import {
  MAX_PUSH_DEVICES,
  type PushSubscriptionResponse,
  type PushSubscriptionsResponse,
} from "@pr-peek/core";
import type { Response } from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  APP_URL,
  bodyOf,
  makeTestApp,
  signIn,
  type Agent,
} from "../../test/app";
import { createTestDb, resetDb } from "../../test/db";
import { pushRouter } from "./push";

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
  const push = options.pushOn === false ? null : { publicKey: PUBLIC_KEY };
  const { agent } = makeTestApp(db, { routers: [pushRouter({ db, push })] });
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

it("needs sign in for devices", async () => {
  const { agent } = makeTestApp(db, {
    routers: [pushRouter({ db, push: null })],
  });
  expect((await agent.get("/api/push/subscriptions")).status).toBe(401);
});
