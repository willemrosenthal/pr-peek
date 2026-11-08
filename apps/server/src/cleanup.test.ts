import { afterAll, beforeEach, expect, it } from "vitest";
import { createTestDb, resetDb } from "../test/db";
import { githubTokens, githubUser, hours, NOW, TEST_KEY } from "../test/fakes";
import { itemRows } from "../test/items";
import { cleanUpOldData } from "./cleanup";
import { upsertGitHubUser } from "./users";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const { makePr, makeItem } = itemRows(db);
const DAY = 24;

it("deletes resolved items over 30 days old with their push logs, and keeps the rest", async () => {
  const { user } = await upsertGitHubUser(
    db,
    githubUser(),
    githubTokens(),
    TEST_KEY,
  );
  // Seen just now, so it stays.
  const pr = await makePr(user.id);
  // Resolved over 30 days ago: deleted.
  const old = await makeItem(user.id, pr.id, "review_requested", {
    status: "resolved",
    resolvedAt: hours(-31 * DAY),
  });
  const recent = await makeItem(user.id, pr.id, "commented", {
    status: "resolved",
    resolvedAt: hours(-29 * DAY),
  });
  const open = await makeItem(user.id, pr.id, "assigned");
  const log = (itemId: string, eventId: string) =>
    db.notificationLog.create({
      data: {
        userId: user.id,
        itemId,
        eventId,
        channel: "push",
        sentAt: hours(-31 * DAY),
      },
    });
  await log(old.id, "E_old");
  // An open item's old log stays, so its reminder doesn't push again.
  await log(open.id, "E_open:late");

  expect(await cleanUpOldData(db, NOW)).toEqual({ items: 1, prs: 0 });
  expect((await db.item.findMany()).map((i) => i.id).sort()).toEqual(
    [recent.id, open.id].sort(),
  );
  expect((await db.notificationLog.findMany()).map((l) => l.eventId)).toEqual([
    "E_open:late",
  ]);
});

it("deletes PRs no search has found for a week, with nothing open, but keeps important ones", async () => {
  const { user } = await upsertGitHubUser(
    db,
    githubUser(),
    githubTokens(),
    TEST_KEY,
  );
  const unseen = await makePr(user.id, 1, { state: "closed" });
  const important = await makePr(user.id, 2, {
    state: "merged",
    importantAt: hours(-10 * DAY),
  });
  const seen = await makePr(user.id, 3);
  await db.pullRequest.updateMany({
    where: { id: { in: [unseen.id, important.id] } },
    data: { lastSeenAt: hours(-8 * DAY) },
  });
  await db.pullRequest.update({
    where: { id: seen.id },
    data: { lastSeenAt: hours(-1) },
  });

  expect((await cleanUpOldData(db, NOW)).prs).toBe(1);
  expect((await db.pullRequest.findMany()).map((p) => p.id).sort()).toEqual(
    [important.id, seen.id].sort(),
  );
});
