import { afterAll, beforeEach, expect, it } from "vitest";
import { APP_URL, makeTestApp, signIn } from "../../test/app";
import { createTestDb, resetDb } from "../../test/db";
import { NOW } from "../../test/fakes";
import { desktopRouter } from "./desktop";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const app = () =>
  makeTestApp(db, { routers: [desktopRouter({ db, now: () => NOW })] });

it("records the Mac menu bar app's heartbeat", async () => {
  const { agent } = app();
  await signIn(agent);

  const res = await agent.post("/api/desktop/heartbeat").set("Origin", APP_URL);
  expect(res.status).toBe(204);
  const user = await db.user.findFirstOrThrow();
  expect(user.desktopSeenAt).toEqual(NOW);
});

it("needs sign in", async () => {
  const res = await app()
    .agent.post("/api/desktop/heartbeat")
    .set("Origin", APP_URL);
  expect(res.status).toBe(401);
});
