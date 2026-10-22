import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, resetDb } from "../test/db";
import { githubTokens, githubUser, hours, NOW, TEST_KEY } from "../test/fakes";
import { itemRows } from "../test/items";
import { createLogger } from "./logger";
import { notifyItem } from "./notify";
import type { SendPush } from "./push";
import { sendDueReminders } from "./reminders";
import { upsertGitHubUser } from "./users";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const logger = createLogger({ LOG_LEVEL: "silent" });
const { makePr, makeItem } = itemRows(db);
// A review request asked for at NOW, whose rule notifies, and one device. It turns orange
// at hours(4) and red at hours(24).
async function setup() {
  const { user } = await upsertGitHubUser(
    db,
    githubUser(),
    githubTokens(),
    TEST_KEY,
  );
  await db.ruleSetting.update({
    where: { userId_ruleId: { userId: user.id, ruleId: "review_requested" } },
    data: { channels: ["list", "push"] },
  });
  await db.pushSubscription.create({
    data: {
      userId: user.id,
      endpoint: "https://fcm.googleapis.com/fcm/send/phone",
      p256dh: "p256dh-key",
      auth: "auth-key",
    },
  });
  const pr = await makePr(user.id);
  const item = await makeItem(user.id, pr.id, "review_requested", {
    occurredAt: NOW,
    waitingSince: NOW,
  });
  const send = vi.fn<SendPush>(() => Promise.resolve());
  const run = (now: Date) => sendDueReminders({ db, send, logger }, now);
  const settings = (data: object) =>
    db.userSettings.update({ where: { userId: user.id }, data });
  return { user, pr, item, send, run, settings };
}

describe("sendDueReminders", () => {
  it("reminds once when a request turns orange, then once at red", async () => {
    const { send, run } = await setup();
    expect(await run(hours(3))).toBe(0);
    expect(await run(hours(5))).toBe(1);
    expect(await run(hours(6))).toBe(0);
    expect(await run(hours(25))).toBe(1);
    expect(await run(hours(48))).toBe(0);

    expect(send.mock.calls[0]?.[1].title).toBe(
      "Waiting 5h: review_requested summary",
    );
  });

  it("reminds again each interval after red", async () => {
    const { send, run, settings } = await setup();
    await settings({ remindEveryHours: 4 });
    await run(hours(25));
    await run(hours(27));
    await run(hours(29));
    await run(hours(33));
    // Red, then 4 and 8 hours after it.
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("reminds even after the user saw it, and after its first notification", async () => {
    const { item, send, run } = await setup();
    await notifyItem({ db, send, logger, now: () => NOW }, item.id);
    await db.item.update({ where: { id: item.id }, data: { seenAt: NOW } });
    expect(await run(hours(5))).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("waits out quiet hours, then sends", async () => {
    const { run, settings } = await setup();
    // NOW is 12:00 UTC, so orange is at 16:00.
    await settings({ quietStart: "16:00", quietEnd: "18:00" });
    expect(await run(hours(5))).toBe(0);
    expect(await run(hours(7))).toBe(1);
  });

  it("skips requests whose rule doesn't notify", async () => {
    const { user, run } = await setup();
    await db.ruleSetting.update({
      where: {
        userId_ruleId: { userId: user.id, ruleId: "review_requested" },
      },
      data: { channels: ["list"] },
    });
    expect(await run(hours(5))).toBe(0);
  });

  it("ignores items that don't wait", async () => {
    const { user, pr, item, run } = await setup();
    await db.item.delete({ where: { id: item.id } });
    await makeItem(user.id, pr.id, "reply", { occurredAt: NOW });
    expect(await run(hours(48))).toBe(0);
  });
});
