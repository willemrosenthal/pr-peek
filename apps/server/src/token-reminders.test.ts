import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { addToken, createTestDb, resetDb } from "../test/db";
import { githubTokens, githubUser, hours, NOW, TEST_KEY } from "../test/fakes";
import { createLogger } from "./logger";
import type { SendPush } from "./push";
import { sendTokenReminders } from "./token-reminders";
import { upsertGitHubUser } from "./users";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const logger = createLogger({ LOG_LEVEL: "silent" });
const PHONE = "https://fcm.googleapis.com/fcm/send/phone";

// A user with a phone to push to.
async function makeUser() {
  const { user } = await upsertGitHubUser(
    db,
    githubUser(),
    githubTokens(),
    TEST_KEY,
  );
  await db.pushSubscription.create({
    data: { userId: user.id, endpoint: PHONE, p256dh: "key", auth: "auth" },
  });
  return user;
}

function setup() {
  const send = vi.fn<SendPush>(() => Promise.resolve());
  const run = (now = NOW) => sendTokenReminders({ db, send, logger }, now);
  const bodies = () => send.mock.calls.map(([, payload]) => payload.body);
  return { send, run, bodies };
}

it("pushes once when a token expires within 7 days, and not before", async () => {
  const user = await makeUser();
  await addToken(db, user.id, "github_pat_later", {
    name: "later",
    expiresAt: hours(24 * 8),
  });
  await addToken(db, user.id, "github_pat_soon", {
    name: "acme",
    expiresAt: hours(24 * 5),
  });
  const { run, bodies } = setup();

  expect(await run()).toBe(1);
  expect(bodies()).toEqual([
    "Your acme token expires in 5 days. Replace it to keep its repos syncing.",
  ]);
  expect(await run(hours(1))).toBe(0);
});

it("pushes once when a token stops working", async () => {
  const user = await makeUser();
  await addToken(db, user.id, "github_pat_stopped", {
    name: "acme",
    status: "stopped",
  });
  const { send, run } = setup();

  expect(await run()).toBe(1);
  const [, payload] = send.mock.calls[0]!;
  expect(payload.url).toBe("/settings/general");
  expect(payload.body).toContain("Your acme token stopped working.");
  expect(await run(hours(1))).toBe(0);
});

it("waits out the user's quiet hours", async () => {
  const user = await makeUser();
  await db.userSettings.update({
    where: { userId: user.id },
    data: { quietStart: "11:00", quietEnd: "13:00" },
  });
  await addToken(db, user.id, "github_pat_stopped", { status: "stopped" });
  const { run } = setup();

  expect(await run()).toBe(0);
  expect(await run(hours(2))).toBe(1);
});

it("sends nothing when push is off", async () => {
  const user = await makeUser();
  await addToken(db, user.id, "github_pat_stopped", { status: "stopped" });
  expect(await sendTokenReminders({ db, send: null, logger }, NOW)).toBe(0);
});
