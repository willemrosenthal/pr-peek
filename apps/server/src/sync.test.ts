import type { PrSnapshot } from "@pr-peek/core";
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, resetDb, TEST_DATABASE_URL } from "../test/db";
import { githubTokens, githubUser, hours, NOW, TEST_KEY } from "../test/fakes";
import { fakeGraphQL } from "../test/github";
import {
  detailIds,
  githubPr,
  prGitHub,
  searchHit,
  searchQueries,
  teamQueries,
  type FakePrGitHub,
} from "../test/pulls";
import { ITEMS_CHANNEL } from "./items";
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

    expect(result).toMatchObject({
      found: 1,
      fetched: 1,
      failed: [],
      deleted: 0,
    });
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
    expect(result).toEqual({
      found: 0,
      fetched: 0,
      failed: [],
      deleted: 0,
      newEventItemIds: [],
    });
  });
});

describe("items", () => {
  const items = () => db.item.findMany({ orderBy: { kind: "asc" } });
  const itemOf = async (kind: string) =>
    db.item.findFirstOrThrow({ where: { kind } });
  const asked = (pr = githubPr(), updatedAt = "2026-10-21T10:00:00Z") => ({
    reviewRequested: [searchHit("PR_1", { repoId: WATCHED, updatedAt })],
    prs: { PR_1: { ...pr, updatedAt } },
  });

  it("saves what the rules find on each fetched PR", async () => {
    const user = await makeUser();
    const { result } = await sync(user.id, asked());

    const pr = await db.pullRequest.findFirstOrThrow();
    const saved = await items();
    // The fixture asks octocat to review, and has a bot reply and a mention after
    // octocat's thread comment.
    expect(saved).toMatchObject([
      {
        userId: user.id,
        pullRequestId: pr.id,
        kind: "reply",
        dedupeKey: "reply:PR_1",
        latestEventId: "IC_1",
        eventCount: 2,
        actorLogin: "ghost",
        occurredAt: new Date("2026-10-21T09:30:00Z"),
        waitingSince: null,
        status: "open",
        seenAt: null,
      },
      {
        kind: "review_requested",
        dedupeKey: "rr:PR_1:RRE_1",
        latestEventId: "RRE_1",
        waitingSince: new Date("2026-10-21T08:00:00Z"),
        status: "open",
      },
    ]);
    expect(result.newEventItemIds.sort()).toEqual(
      saved.map((item) => item.id).sort(),
    );
  });

  it("notifies only about new events", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    const reply = await itemOf("reply");
    await db.item.updateMany({ data: { seenAt: NOW } });

    // The PR changed on GitHub, but nothing new for the user.
    const same = await sync(user.id, asked(githubPr(), "2026-10-21T11:00:00Z"));
    expect(same.result.newEventItemIds).toEqual([]);
    expect((await itemOf("reply")).seenAt).toEqual(NOW);

    const pr = githubPr({
      comments: {
        nodes: [
          ...githubPr().comments.nodes,
          {
            id: "IC_2",
            author: { __typename: "User", login: "jlee" },
            bodyText: "Ping @octocat",
            createdAt: "2026-10-21T11:30:00Z",
          },
        ],
      },
    });
    const replied = await sync(user.id, asked(pr, "2026-10-21T12:00:00Z"));
    expect(replied.result.newEventItemIds).toEqual([reply.id]);
    expect(await itemOf("reply")).toMatchObject({
      latestEventId: "IC_2",
      eventCount: 3,
      seenAt: null,
    });
  });

  it("resolves items once you act on them", async () => {
    const user = await makeUser();
    await sync(user.id, asked());

    const pr = githubPr();
    pr.reviewRequests.nodes = [];
    pr.reviews.nodes.push({
      id: "R_3",
      state: "COMMENTED",
      submittedAt: "2026-10-21T10:30:00Z",
      author: { __typename: "User", login: "octocat" },
    });
    const later = hours(1);
    await sync(user.id, asked(pr, "2026-10-21T10:30:00Z"), later);

    expect(await items()).toMatchObject([
      { kind: "reply", status: "resolved", resolvedAt: later },
      { kind: "review_requested", status: "resolved", resolvedAt: later },
    ]);
  });

  it("resolves items when the PR leaves the searches, and reopens them if it comes back", async () => {
    const user = await makeUser();
    await sync(user.id, asked());

    await sync(user.id, {}, hours(1));
    expect(await db.item.count({ where: { status: "open" } })).toBe(0);

    const { result } = await sync(user.id, asked(), hours(2));
    expect(await db.item.count({ where: { status: "open" } })).toBe(2);
    // Nothing new happened, so no new notification.
    expect(result.newEventItemIds).toEqual([]);
  });

  it("skips rules the user turned off", async () => {
    const user = await makeUser();
    await db.ruleSetting.update({
      where: { userId_ruleId: { userId: user.id, ruleId: "review_requested" } },
      data: { enabled: false },
    });
    await sync(user.id, asked());
    expect((await items()).map((item) => item.kind)).toEqual(["reply"]);
  });

  it("includes drafts only when the user opts in", async () => {
    const user = await makeUser();
    const draft = asked(githubPr({ isDraft: true }));
    await sync(user.id, draft);
    expect(await db.item.count({ where: { kind: "review_requested" } })).toBe(
      0,
    );

    await db.ruleSetting.update({
      where: { userId_ruleId: { userId: user.id, ruleId: "review_requested" } },
      data: { options: { includeDrafts: true } },
    });
    await sync(
      user.id,
      asked(githubPr({ isDraft: true }), "2026-10-21T11:00:00Z"),
    );
    expect(await db.item.count({ where: { kind: "review_requested" } })).toBe(
      1,
    );
  });

  it("leaves out bot replies when bots are hidden", async () => {
    const user = await makeUser();
    await db.userSettings.update({
      where: { userId: user.id },
      data: { hideBots: true },
    });
    await sync(user.id, asked());
    expect(await itemOf("reply")).toMatchObject({ eventCount: 1 });
  });

  it("asks for the user's teams only when a team is asked to review", async () => {
    const user = await makeUser();
    const { requests } = await sync(user.id, asked());
    expect(teamQueries(requests)).toBe(1);

    const pr = githubPr();
    pr.reviewRequests.nodes = [
      { requestedReviewer: { __typename: "User", login: "octocat" } },
    ];
    const again = await sync(user.id, asked(pr, "2026-10-21T11:00:00Z"));
    expect(teamQueries(again.requests)).toBe(0);
  });

  it("tells listeners when the user's items change", async () => {
    const user = await makeUser();
    const listener = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await listener.connect();
    try {
      const payloads: string[] = [];
      listener.on("notification", (msg) => payloads.push(msg.payload ?? ""));
      await listener.query(`LISTEN ${ITEMS_CHANNEL}`);

      await sync(user.id, asked());
      // Nothing changed, so no message.
      await sync(user.id, asked(), hours(1));
      await vi.waitFor(() => expect(payloads).not.toEqual([]));
      // Give a second message time to arrive, if one was sent.
      await new Promise((done) => setTimeout(done, 100));
      expect(payloads).toEqual([user.id]);
    } finally {
      await listener.end();
    }
  });
});
