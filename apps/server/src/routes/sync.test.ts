import type { SyncStatusResponse } from "@pr-peek/core";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_URL,
  bodyOf,
  makeTestApp,
  signIn,
  type Agent,
} from "../../test/app";
import { createTestDb, resetDb } from "../../test/db";
import { hours, minutes, NOW } from "../../test/fakes";
import { syncRouter } from "./sync";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

function makeApp(queued = true) {
  const requestSync = vi.fn(() => Promise.resolve(queued));
  const { agent } = makeTestApp(db, {
    routers: [syncRouter({ db, requestSync, now: () => NOW })],
  });
  return { agent, requestSync };
}

async function setup(queued = true) {
  const app = makeApp(queued);
  await signIn(app.agent);
  const user = await db.user.findFirstOrThrow();
  return { ...app, user };
}

const refresh = (agent: Agent) =>
  agent.post("/api/sync").set("Origin", APP_URL);

it("needs sign in for every sync endpoint", async () => {
  const { agent, requestSync } = makeApp();
  expect((await refresh(agent)).status).toBe(401);
  expect((await agent.get("/api/sync/status")).status).toBe(401);
  expect(requestSync).not.toHaveBeenCalled();
});

describe("POST /api/sync", () => {
  it("queues a sync for the user", async () => {
    const { agent, requestSync, user } = await setup();
    const res = await refresh(agent);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: true });
    expect(requestSync).toHaveBeenCalledWith(user.id);
  });

  it("says so when a sync was already queued or running", async () => {
    const { agent } = await setup(false);
    expect((await refresh(agent)).body).toEqual({ queued: false });
  });

  it("allows one refresh every 30 seconds", async () => {
    const { agent, requestSync } = await setup();
    await refresh(agent);
    const second = await refresh(agent);

    expect(second.status).toBe(429);
    expect(second.body).toMatchObject({ error: { code: "rate_limited" } });
    expect(requestSync).toHaveBeenCalledOnce();
  });

  it("asks the user to sign in again when their token stopped working", async () => {
    const { agent, requestSync } = await setup();
    await db.user.updateMany({ data: { syncError: "reauth" } });

    const res = await refresh(agent);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: "reauth" } });
    expect(requestSync).not.toHaveBeenCalled();
  });
});

describe("GET /api/sync/status", () => {
  const status = async (agent: Agent) =>
    bodyOf<SyncStatusResponse>(await agent.get("/api/sync/status"));

  it("reports the last sync and any error", async () => {
    const { agent } = await setup();
    expect(await status(agent)).toEqual({
      lastSyncedAt: null,
      syncError: null,
      running: false,
    });

    await db.user.updateMany({
      data: { lastSyncedAt: hours(-1), syncError: "failed" },
    });
    expect(await status(agent)).toEqual({
      lastSyncedAt: hours(-1).toISOString(),
      syncError: "failed",
      running: false,
    });
  });

  it("reports a running sync until it's too old to trust", async () => {
    const { agent } = await setup();
    await db.user.updateMany({ data: { syncStartedAt: minutes(-1) } });
    expect((await status(agent)).running).toBe(true);

    await db.user.updateMany({ data: { syncStartedAt: minutes(-11) } });
    expect((await status(agent)).running).toBe(false);
  });
});
