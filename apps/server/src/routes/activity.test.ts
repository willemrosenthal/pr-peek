import { LOOKING_HEADER } from "@pr-peek/core";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_URL, makeTestApp, signIn } from "../../test/app";
import { createTestDb, resetDb } from "../../test/db";
import { minutes, NOW } from "../../test/fakes";
import { activityRouter } from "./activity";
import { desktopRouter } from "./desktop";
import { syncRouter } from "./sync";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

async function makeApp() {
  const requestSync = vi.fn(() => Promise.resolve(true));
  const now = () => NOW;
  const { agent } = makeTestApp(db, {
    routers: [
      activityRouter({ db, requestSync, now }),
      desktopRouter({ db, now }),
      syncRouter({ db, requestSync: vi.fn(), now }),
    ],
  });
  await signIn(agent);
  return { agent, requestSync };
}

const lastActiveAt = async () =>
  (await db.user.findFirstOrThrow()).lastActiveAt;
type Agent = Awaited<ReturnType<typeof makeApp>>["agent"];
// Any signed in request from a page someone can see counts.
const openApp = (agent: Agent) =>
  agent.get("/api/sync/status").set(LOOKING_HEADER, "1");

describe("activityRouter", () => {
  it("records when the user used the app, at most every 10 minutes", async () => {
    const { agent } = await makeApp();

    await db.user.updateMany({ data: { lastActiveAt: minutes(-5) } });
    await openApp(agent);
    expect(await lastActiveAt()).toEqual(minutes(-5));

    await db.user.updateMany({ data: { lastActiveAt: minutes(-11) } });
    await openApp(agent);
    expect(await lastActiveAt()).toEqual(NOW);
  });

  it("doesn't count requests no one sees, like the hidden Mac app's", async () => {
    const { agent, requestSync } = await makeApp();
    await db.user.updateMany({ data: { lastActiveAt: minutes(-60) } });

    await agent.get("/api/sync/status");
    await agent.post("/api/desktop/heartbeat").set("Origin", APP_URL);
    expect(await lastActiveAt()).toEqual(minutes(-60));
    expect(requestSync).not.toHaveBeenCalled();
  });

  it("syncs right away when the user comes back to an old list", async () => {
    const { agent, requestSync } = await makeApp();
    await db.user.updateMany({
      data: { lastActiveAt: minutes(-60), lastSyncedAt: minutes(-5) },
    });

    await openApp(agent);
    expect(requestSync).toHaveBeenCalledOnce();
  });

  it("doesn't sync when the list is fresh", async () => {
    const { agent, requestSync } = await makeApp();
    await db.user.updateMany({
      data: { lastActiveAt: minutes(-60), lastSyncedAt: minutes(-1) },
    });

    await openApp(agent);
    expect(requestSync).not.toHaveBeenCalled();
  });

  it("doesn't sync while the user is still using the app", async () => {
    const { agent, requestSync } = await makeApp();
    await db.user.updateMany({
      data: { lastActiveAt: minutes(-5), lastSyncedAt: minutes(-5) },
    });

    await openApp(agent);
    expect(requestSync).not.toHaveBeenCalled();
  });

  it("leaves users alone who must sign in again, or are backing off", async () => {
    const { agent, requestSync } = await makeApp();
    await db.user.updateMany({
      data: { lastActiveAt: minutes(-60), syncError: "reauth" },
    });
    await openApp(agent);

    await db.user.updateMany({
      data: {
        lastActiveAt: minutes(-60),
        syncError: "failed",
        syncRetryAt: minutes(5),
      },
    });
    await openApp(agent);
    expect(requestSync).not.toHaveBeenCalled();
  });

  it("still answers when the sync can't be queued", async () => {
    const { agent, requestSync } = await makeApp();
    requestSync.mockRejectedValueOnce(new Error("database is busy"));
    await db.user.updateMany({ data: { lastActiveAt: minutes(-60) } });

    expect((await openApp(agent)).status).toBe(200);
  });
});
