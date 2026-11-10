import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, resetDb } from "../test/db";
import { desktopNotifications } from "../test/desktop";
import { githubTokens, githubUser, hours, TEST_KEY } from "../test/fakes";
import { itemRows } from "../test/items";
import { createLogger } from "./logger";
import type { SendPush } from "./push";
import { sendDueSummaries } from "./summary";
import { upsertGitHubUser } from "./users";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const logger = createLogger({ LOG_LEVEL: "silent" });
const { makePr, makeItem } = itemRows(db);
// 09:05 UTC, just after a 09:00 summary time.
const AT_NINE = new Date("2026-10-23T09:05:00Z");
const PHONE = "https://fcm.googleapis.com/fcm/send/phone";

// A user with a 09:00 summary, one device, and a review request waiting 5 hours.
async function setup() {
  const { user } = await upsertGitHubUser(
    db,
    githubUser(),
    githubTokens(),
    TEST_KEY,
  );
  await db.userSettings.update({
    where: { userId: user.id },
    data: { digestTime: "09:00" },
  });
  await db.pushSubscription.create({
    data: {
      userId: user.id,
      endpoint: PHONE,
      p256dh: "p256dh-key",
      auth: "auth-key",
    },
  });
  const pr = await makePr(user.id);
  const item = await makeItem(user.id, pr.id, "review_requested", {
    waitingSince: new Date("2026-10-23T04:00:00Z"),
  });
  const send = vi.fn<SendPush>(() => Promise.resolve());
  const run = (now = AT_NINE) => sendDueSummaries({ db, send, logger }, now);
  return { user, item, send, run };
}

describe("sendDueSummaries", () => {
  it("sends the summary to every device at the user's time", async () => {
    const { send, run } = await setup();

    expect(await run()).toBe(1);
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ endpoint: PHONE }),
      {
        title: "Morning summary",
        body: "1 review waiting (oldest 5h)",
        url: "/",
        tag: "summary",
        badge: 1,
      },
      { ttlSeconds: 12 * 60 * 60, urgency: "normal" },
    );
  });

  it("sends once a day, even when run again or twice at once", async () => {
    const { send, run } = await setup();
    await Promise.all([run(), run()]);
    await run(new Date("2026-10-23T09:20:00Z"));
    expect(send).toHaveBeenCalledOnce();

    await run(new Date("2026-10-24T09:05:00Z"));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("waits until the summary time", async () => {
    const { send, run } = await setup();
    expect(await run(new Date("2026-10-23T08:55:00Z"))).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves out reviews waiting on the author", async () => {
    const { item, send, run } = await setup();
    await db.item.update({
      where: { id: item.id },
      data: { waitingOnAuthor: true, waitingSince: null },
    });
    expect(await run()).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips the day when nothing is open", async () => {
    const { item, send, run } = await setup();
    await db.item.update({
      where: { id: item.id },
      data: { status: "resolved", resolvedAt: hours(-1) },
    });
    expect(await run()).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips users with the summary off, or no devices", async () => {
    const { user, send, run } = await setup();
    await db.userSettings.update({
      where: { userId: user.id },
      data: { digestTime: null },
    });
    expect(await run()).toBe(0);

    await db.userSettings.update({
      where: { userId: user.id },
      data: { digestTime: "09:00" },
    });
    await db.pushSubscription.deleteMany();
    expect(await run()).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends to the running Mac menu bar app, even with no push devices", async () => {
    const { user, send, run } = await setup();
    await db.pushSubscription.deleteMany();
    await db.user.update({
      where: { id: user.id },
      data: { desktopSeenAt: new Date(AT_NINE.getTime() - 60_000) },
    });
    const toApp = await desktopNotifications(user.id);

    expect(await run()).toBe(1);
    expect(send).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(toApp).toHaveLength(1));
    expect(toApp[0]?.payload.title).toBe("Morning summary");
  });

  it("does nothing when push is off", async () => {
    await setup();
    expect(await sendDueSummaries({ db, send: null, logger }, AT_NINE)).toBe(0);
  });
});
