import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { createTestDb, resetDb } from "../test/db";
import { githubTokens, githubUser, NOW, TEST_KEY } from "../test/fakes";
import { fakeGraphQL } from "../test/github";
import { githubPr, prGitHub, searchHit } from "../test/pulls";
import { fillSnapshotColumns } from "./backfill";
import { syncUser } from "./sync";
import { upsertGitHubUser } from "./users";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

// A user with PR_1 and PR_2 saved by a sync, as rows from before the columns existed.
async function setup() {
  const { user } = await upsertGitHubUser(
    db,
    githubUser(),
    githubTokens(),
    TEST_KEY,
  );
  await db.watchedRepo.create({
    data: { userId: user.id, githubRepoId: 1, owner: "acme", name: "web-app" },
  });
  const { octokit } = fakeGraphQL(
    prGitHub({
      reviewRequested: [searchHit("PR_1"), searchHit("PR_2")],
      prs: {
        PR_1: githubPr(),
        PR_2: { ...githubPr(), id: "PR_2", number: 8 },
      },
    }),
  );
  const github = vi.fn(() => Promise.resolve(octokit));
  await syncUser({ db, github, now: () => NOW }, user.id);
  await db.pullRequest.updateMany({
    data: { lastPushSha: null, listGroup: null, assignedState: null },
  });
}

it("fills the columns from each PR's snapshot, merged ones too", async () => {
  await setup();
  await db.pullRequest.updateMany({
    where: { githubNodeId: "PR_2" },
    data: { state: "merged" },
  });

  expect(await fillSnapshotColumns(db)).toBe(2);
  for (const row of await db.pullRequest.findMany()) {
    expect(row).toMatchObject({
      lastPushSha: "abc123",
      listGroup: "review",
      assignedState: "checks_failing",
    });
  }
  // Nothing left to fill.
  expect(await fillSnapshotColumns(db)).toBe(0);
});

it("skips a snapshot it can't read, and fills the rest", async () => {
  await setup();
  await db.pullRequest.updateMany({
    where: { githubNodeId: "PR_1" },
    data: { snapshot: { not: "a snapshot" } },
  });

  expect(await fillSnapshotColumns(db)).toBe(1);
  const broken = await db.pullRequest.findFirstOrThrow({
    where: { githubNodeId: "PR_1" },
  });
  expect(broken.lastPushSha).toBeNull();
});
