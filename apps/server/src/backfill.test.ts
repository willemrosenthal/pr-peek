import { afterAll, beforeEach, expect, it } from "vitest";
import { createTestDb, resetDb } from "../test/db";
import { githubTokens, githubUser, TEST_KEY } from "../test/fakes";
import { itemRows, storedSnapshot } from "../test/items";
import { fillSnapshotColumns } from "./backfill";
import { upsertGitHubUser } from "./users";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const { makePr } = itemRows(db);

// PRs from before the columns existed: assigned to the user, with failing checks.
const snapshot = storedSnapshot({
  assignees: ["octocat"],
  checks: { state: "FAILURE", failing: [] },
});

async function makeUser() {
  const { user } = await upsertGitHubUser(
    db,
    githubUser(),
    githubTokens(),
    TEST_KEY,
  );
  return user;
}

it("fills the columns from each PR's snapshot, merged ones too", async () => {
  const user = await makeUser();
  await makePr(user.id, 7, { snapshot });
  await makePr(user.id, 8, { snapshot, state: "merged" });

  expect(await fillSnapshotColumns(db)).toBe(2);
  for (const row of await db.pullRequest.findMany()) {
    expect(row).toMatchObject({
      lastPushSha: "abc123",
      listGroup: "assigned",
      assignedState: "checks_failing",
    });
  }
  // Nothing left to fill.
  expect(await fillSnapshotColumns(db)).toBe(0);
});

it("skips a PR without a snapshot it can read, and fills the rest", async () => {
  const user = await makeUser();
  await makePr(user.id, 7, { snapshot: { not: "a snapshot" } });
  // Saved after snapshots stopped, so the sync filled it already. Or never had one.
  await makePr(user.id, 8);
  await makePr(user.id, 9, { snapshot });

  expect(await fillSnapshotColumns(db)).toBe(1);
  const filled = await db.pullRequest.findMany({
    where: { lastPushSha: { not: null } },
  });
  expect(filled.map((row) => row.number)).toEqual([9]);
});
