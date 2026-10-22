import type { PrSnapshot } from "@pr-peek/core";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, resetDb } from "../test/db";
import { githubTokens, githubUser, hours, NOW, TEST_KEY } from "../test/fakes";
import { fakeGraphQL } from "../test/github";
import {
  detailIds,
  githubPr,
  prGitHub,
  searchHit,
  searchQueries,
  type FakePrGitHub,
} from "../test/pulls";
import { syncUser } from "./sync";
import { upsertGitHubUser } from "./users";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const WATCHED = 1;
const DISABLED = 2;
const UNWATCHED = 3;

async function makeUser() {
  const { user } = await upsertGitHubUser(
    db,
    githubUser(),
    githubTokens(),
    TEST_KEY,
    "oauth",
  );
  await db.watchedRepo.createMany({
    data: [
      {
        userId: user.id,
        githubRepoId: WATCHED,
        owner: "acme",
        name: "web-app",
      },
      {
        userId: user.id,
        githubRepoId: DISABLED,
        owner: "acme",
        name: "old",
        enabled: false,
      },
    ],
  });
  return user;
}

// Runs one sync against a fake GitHub, at `now`.
async function sync(userId: string, fake: FakePrGitHub, now = NOW) {
  const { octokit, requests } = fakeGraphQL(prGitHub(fake));
  const github = vi.fn(() => Promise.resolve(octokit));
  const result = await syncUser({ db, github, now: () => now }, userId);
  return { result, requests, github };
}

const prs = { PR_1: githubPr() };

describe("syncUser", () => {
  it("saves new PRs from watched repos", async () => {
    const user = await makeUser();
    const { result } = await sync(user.id, {
      reviewRequested: [
        searchHit("PR_1", { repoId: WATCHED }),
        searchHit("PR_2", { repoId: DISABLED }),
        searchHit("PR_3", { repoId: UNWATCHED }),
      ],
      prs,
    });

    expect(result).toEqual({ found: 1, fetched: 1, failed: [], deleted: 0 });
    const row = await db.pullRequest.findFirstOrThrow();
    expect(row).toMatchObject({
      userId: user.id,
      githubNodeId: "PR_1",
      githubRepoId: WATCHED,
      repoOwner: "acme",
      repoName: "web-app",
      number: 7,
      title: "Add login",
      authorLogin: "sam",
      isDraft: false,
      state: "open",
      headSha: "abc123",
      checkState: "FAILURE",
      githubUpdatedAt: new Date("2026-10-21T10:00:00Z"),
      lastSeenAt: NOW,
    });
    expect((row.snapshot as PrSnapshot).reviews).toHaveLength(1);
    expect(await db.pullRequest.count()).toBe(1);

    const saved = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved.lastSyncedAt).toEqual(NOW);
  });

  it("only searches when nothing changed", async () => {
    const user = await makeUser();
    const github = {
      reviewRequested: [searchHit("PR_1", { repoId: WATCHED })],
      prs,
    };
    await sync(user.id, github);

    const later = hours(1);
    const { result, requests } = await sync(user.id, github, later);

    expect(result).toMatchObject({ found: 1, fetched: 0 });
    expect(detailIds(requests)).toEqual([]);
    expect(searchQueries(requests)).toHaveLength(3);
    const row = await db.pullRequest.findFirstOrThrow();
    expect(row.lastSeenAt).toEqual(later);
  });

  it("fetches PRs that changed", async () => {
    const user = await makeUser();
    await sync(user.id, {
      reviewRequested: [searchHit("PR_1", { repoId: WATCHED })],
      prs,
    });

    const updatedAt = "2026-10-21T11:00:00Z";
    const { requests } = await sync(user.id, {
      reviewRequested: [searchHit("PR_1", { repoId: WATCHED, updatedAt })],
      prs: { PR_1: githubPr({ title: "Add login v2", updatedAt }) },
    });

    expect(detailIds(requests)).toEqual(["PR_1"]);
    const row = await db.pullRequest.findFirstOrThrow();
    expect(row).toMatchObject({
      title: "Add login v2",
      githubUpdatedAt: new Date(updatedAt),
    });
  });

  it("fetches the user's own PRs when their checks change", async () => {
    const user = await makeUser();
    await sync(user.id, {
      authored: [searchHit("PR_1", { repoId: WATCHED, checkState: "FAILURE" })],
      prs,
    });

    const { requests } = await sync(user.id, {
      authored: [searchHit("PR_1", { repoId: WATCHED, checkState: "SUCCESS" })],
      prs,
    });
    expect(detailIds(requests)).toEqual(["PR_1"]);
  });

  it("ignores check changes on other people's PRs", async () => {
    const user = await makeUser();
    await sync(user.id, {
      reviewRequested: [
        searchHit("PR_1", { repoId: WATCHED, checkState: "FAILURE" }),
      ],
      prs,
    });

    const { requests } = await sync(user.id, {
      reviewRequested: [
        searchHit("PR_1", { repoId: WATCHED, checkState: "SUCCESS" }),
      ],
      prs,
    });
    expect(detailIds(requests)).toEqual([]);
  });

  it("keeps PRs that left the searches for 7 days, then deletes them", async () => {
    const user = await makeUser();
    await sync(user.id, {
      reviewRequested: [searchHit("PR_1", { repoId: WATCHED })],
      prs,
    });

    await sync(user.id, {}, hours(24 * 7 - 1));
    const row = await db.pullRequest.findFirstOrThrow();
    expect(row.lastSeenAt).toEqual(NOW);

    const { result } = await sync(user.id, {}, hours(24 * 7 + 1));
    expect(result.deleted).toBe(1);
    expect(await db.pullRequest.count()).toBe(0);
  });

  it("reports PRs it couldn't read and saves the rest", async () => {
    const user = await makeUser();
    const { result } = await sync(user.id, {
      reviewRequested: [
        searchHit("PR_1", { repoId: WATCHED }),
        searchHit("PR_gone", { repoId: WATCHED }),
      ],
      prs,
    });

    expect(result).toMatchObject({
      found: 2,
      fetched: 1,
      failed: [{ id: "PR_gone", error: "not found" }],
    });
    expect(await db.pullRequest.count()).toBe(1);
  });

  it("uses the user's team request setting", async () => {
    const user = await makeUser();
    await db.userSettings.update({
      where: { userId: user.id },
      data: { includeTeamRequests: false },
    });
    const { requests } = await sync(user.id, {});
    expect(searchQueries(requests)[0]).toMatch(/ user-review-requested:@me$/);
  });

  it("doesn't call GitHub when no repos are watched", async () => {
    const user = await makeUser();
    await db.watchedRepo.deleteMany();

    const { result, github } = await sync(user.id, {});

    expect(github).not.toHaveBeenCalled();
    expect(result).toEqual({ found: 0, fetched: 0, failed: [], deleted: 0 });
  });
});
