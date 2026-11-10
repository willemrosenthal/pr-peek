import { RequestError } from "octokit";
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addToken, createTestDb, resetDb, TEST_DATABASE_URL } from "../test/db";
import {
  githubTokens,
  githubUser,
  hours,
  minutes,
  NOW,
  TEST_KEY,
} from "../test/fakes";
import { fakeGraphQL, reposGitHub } from "../test/github";
import { itemRows } from "../test/items";
import {
  checkContexts,
  detailIds,
  githubPr,
  prGitHub,
  recentCommit,
  searchHit,
  searchQueries,
  statusIds,
  teamQueries,
  type FakePrGitHub,
  withHeadChecks,
} from "../test/pulls";
import { ITEMS_CHANNEL } from "./items";
import { NeedsReauthError, type TokenChoice } from "./github/tokens";
import { refreshTokenOwners, syncUser } from "./sync";
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

// Runs one sync against a fake GitHub, at `now`. `rulesChangedAt` is the worker's start.
async function sync(
  userId: string,
  fake: FakePrGitHub,
  now = NOW,
  rulesChangedAt?: Date,
) {
  const { octokit, requests } = fakeGraphQL(prGitHub(fake));
  const github = vi.fn(() => Promise.resolve(octokit));
  const result = await syncUser(
    { db, github, now: () => now, ...(rulesChangedAt && { rulesChangedAt }) },
    userId,
  );
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
      checkFingerprint:
        "runs: FAILURE 1, IN_PROGRESS 1, SUCCESS 1; statuses: ERROR 1",
      githubUpdatedAt: new Date("2026-10-21T10:00:00Z"),
      lastSeenAt: NOW,
      // What the list needs, worked out from the details.
      lastPushSha: "abc123",
      listGroup: "review",
      assignedState: "checks_failing",
    });
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
    expect(searchQueries(requests)).toHaveLength(2);
  });

  it("moves a found PR's lastSeenAt forward at most once an hour", async () => {
    const user = await makeUser();
    const github = {
      reviewRequested: [searchHit("PR_1", { repoId: WATCHED })],
      prs,
    };
    await sync(user.id, github);
    const lastSeenAt = async () =>
      (await db.pullRequest.findFirstOrThrow()).lastSeenAt;

    await sync(user.id, github, minutes(30));
    expect(await lastSeenAt()).toEqual(NOW);

    await sync(user.id, github, minutes(61));
    expect(await lastSeenAt()).toEqual(minutes(61));
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
    const own = {
      PR_1: githubPr({ author: { __typename: "User", login: "OctoCat" } }),
    };
    await sync(user.id, {
      authored: [searchHit("PR_1", { repoId: WATCHED, checkState: "FAILURE" })],
      prs: own,
    });

    const { requests } = await sync(user.id, {
      authored: [searchHit("PR_1", { repoId: WATCHED, checkState: "SUCCESS" })],
      prs: own,
    });
    expect(detailIds(requests)).toEqual(["PR_1"]);
  });

  it("fetches PRs the user is assigned to when their checks change", async () => {
    const user = await makeUser();
    const assigned = {
      PR_1: githubPr({ assignees: { nodes: [{ login: "octocat" }] } }),
    };
    await sync(user.id, {
      assigned: [searchHit("PR_1", { repoId: WATCHED, checkState: "PENDING" })],
      prs: assigned,
    });

    const { requests } = await sync(user.id, {
      assigned: [searchHit("PR_1", { repoId: WATCHED, checkState: "SUCCESS" })],
      prs: assigned,
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

  it("goes by the newest run of each check, and notices when any run finishes", async () => {
    const user = await makeUser();
    // The user's PR. Its title check ran twice: the first run was cancelled, the second
    // passed. GitHub's own state still says FAILURE.
    const pr = githubPr({
      author: { __typename: "User", login: "octocat" },
      ...withHeadChecks({
        contexts: checkContexts([
          {
            __typename: "CheckRun",
            name: "pr-title",
            conclusion: "CANCELLED",
            startedAt: "2026-10-21T07:01:00Z",
            detailsUrl: null,
          },
          {
            __typename: "CheckRun",
            name: "pr-title",
            conclusion: "SUCCESS",
            startedAt: "2026-10-21T07:02:00Z",
            detailsUrl: null,
          },
        ]),
      }),
    });
    const runs = { CANCELLED: 1, SUCCESS: 1 };
    const hit = searchHit("PR_1", { repoId: WATCHED, checkRuns: runs });
    await sync(user.id, { authored: [hit], prs: { PR_1: pr } });

    expect(
      await db.item.count({ where: { kind: "check_failed", status: "open" } }),
    ).toBe(0);
    // The same runs, so nothing is fetched again.
    const same = await sync(user.id, { authored: [hit] }, hours(1));
    expect(detailIds(same.requests)).toEqual([]);

    // Another check finished on the same commit. GitHub's own state was FAILURE before
    // and after, but the counts changed, so it's fetched again.
    const finished = searchHit("PR_1", {
      repoId: WATCHED,
      checkRuns: { ...runs, FAILURE: 1 },
    });
    const later = await sync(
      user.id,
      { authored: [finished], prs: { PR_1: pr } },
      hours(2),
    );
    expect(detailIds(later.requests)).toEqual(["PR_1"]);
  });

  it("deletes PRs 7 days after the searches last found them, once nothing is open", async () => {
    const user = await makeUser();
    await sync(user.id, {
      reviewRequested: [searchHit("PR_1", { repoId: WATCHED })],
      prs,
    });

    // Merged, so its items are resolved.
    const merged = {
      statuses: { PR_1: searchHit("PR_1", { state: "MERGED" }) },
    };
    await sync(user.id, merged, hours(24 * 7 - 1));
    const row = await db.pullRequest.findFirstOrThrow();
    expect(row).toMatchObject({ lastSeenAt: NOW, state: "merged" });

    const { result } = await sync(user.id, merged, hours(24 * 7 + 1));
    expect(result.deleted).toBe(1);
    expect(await db.pullRequest.count()).toBe(0);
  });

  it("keeps important PRs past 7 days while open or merged, until unmarked", async () => {
    const user = await makeUser();
    await sync(user.id, {
      reviewRequested: [searchHit("PR_1", { repoId: WATCHED })],
      prs,
    });
    await db.pullRequest.updateMany({ data: { importantAt: NOW } });
    // Nothing on it needs the user, so only the mark keeps it.
    await db.ruleSetting.updateMany({ data: { enabled: false } });

    const open = { statuses: { PR_1: searchHit("PR_1") } };
    expect((await sync(user.id, open, hours(24 * 8))).result.deleted).toBe(0);
    const merged = {
      statuses: { PR_1: searchHit("PR_1", { state: "MERGED" }) },
    };
    expect((await sync(user.id, merged, hours(24 * 9))).result.deleted).toBe(0);

    await db.pullRequest.updateMany({ data: { importantAt: null } });
    const { result } = await sync(user.id, merged, hours(24 * 10));
    expect(result.deleted).toBe(1);
  });

  it("keeps PRs with open items past 7 days", async () => {
    const user = await makeUser();
    await sync(user.id, asked());

    // The searches stop finding it, but it's still open and still asks for a review.
    const missed = { statuses: { PR_1: searchHit("PR_1") } };
    const { result } = await sync(user.id, missed, hours(24 * 8));
    expect(result.deleted).toBe(0);
    expect(await db.pullRequest.count()).toBe(1);
  });

  it("checks only tracked PRs the searches missed", async () => {
    const user = await makeUser();
    await sync(user.id, {
      reviewRequested: [
        searchHit("PR_1", { repoId: WATCHED }),
        searchHit("PR_2", { repoId: WATCHED }),
      ],
      prs: { PR_1: githubPr(), PR_2: githubPr({ id: "PR_2" }) },
    });

    const { requests, result } = await sync(
      user.id,
      {
        reviewRequested: [searchHit("PR_1", { repoId: WATCHED })],
        statuses: { PR_2: searchHit("PR_2") },
      },
      hours(1),
    );
    expect(statusIds(requests)).toEqual(["PR_2"]);
    // Unchanged, so no details either.
    expect(detailIds(requests)).toEqual([]);
    expect(result.ended).toBe(0);
  });

  it("fetches a missed PR that changed", async () => {
    const user = await makeUser();
    await sync(user.id, asked());

    const updatedAt = "2026-10-21T11:00:00Z";
    const { requests } = await sync(
      user.id,
      {
        statuses: { PR_1: searchHit("PR_1", { updatedAt }) },
        prs: { PR_1: githubPr({ title: "Add login v2", updatedAt }) },
      },
      hours(1),
    );
    expect(detailIds(requests)).toEqual(["PR_1"]);
    expect((await db.pullRequest.findFirstOrThrow()).title).toBe(
      "Add login v2",
    );
  });

  it("stops tracking a PR moved to a repo the user doesn't watch", async () => {
    const user = await makeUser();
    await sync(user.id, asked());

    const moved = searchHit("PR_1", { repoId: UNWATCHED });
    const { result } = await sync(
      user.id,
      { reviewRequested: [moved], statuses: { PR_1: moved } },
      hours(1),
    );
    expect(result.ended).toBe(1);
    expect((await db.pullRequest.findFirstOrThrow()).state).toBe("unwatched");
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
      ended: 0,
      deleted: 0,
      newEventItemIds: [],
      mergedImportantPrIds: [],
      fullPass: false,
    });
  });
});

describe("added PRs", () => {
  const { makePr } = itemRows(db);
  // GitHub's view of PR_9, in a repo the user doesn't watch, by someone else.
  const hit = (options: Parameters<typeof searchHit>[1] = {}) =>
    searchHit("PR_9", { repoId: UNWATCHED, ...options });
  const details = {
    PR_9: githubPr({ id: "PR_9", number: 9, title: "Add search" }),
  };

  // Added by its link, as the route saves it: never synced, so its details load.
  const added = (userId: string) =>
    makePr(userId, 9, {
      githubRepoId: UNWATCHED,
      addedAt: NOW,
      importantAt: NOW,
      githubUpdatedAt: new Date(0),
    });
  const row = () =>
    db.pullRequest.findFirstOrThrow({ where: { githubNodeId: "PR_9" } });

  it("syncs one in a repo the user doesn't watch, until it merges", async () => {
    const user = await makeUser();
    await added(user.id);

    const { requests } = await sync(user.id, {
      statuses: { PR_9: hit() },
      prs: details,
    });
    expect(detailIds(requests)).toEqual(["PR_9"]);
    expect(await row()).toMatchObject({ state: "open", title: "Add search" });

    const { result } = await sync(
      user.id,
      { statuses: { PR_9: hit({ state: "MERGED" }) } },
      hours(1),
    );
    expect(result.mergedImportantPrIds).toEqual([(await row()).id]);
    expect((await row()).state).toBe("merged");
  });

  it("keeps one a search finds, or that moved repos", async () => {
    const user = await makeUser();
    await added(user.id);

    const { result } = await sync(user.id, {
      reviewRequested: [hit()],
      prs: details,
    });
    expect(result).toMatchObject({ found: 1, fetched: 1, ended: 0 });

    const moved = hit({ repoId: DISABLED });
    await sync(user.id, { statuses: { PR_9: moved } }, hours(1));
    expect((await row()).state).toBe("open");
  });

  it("checks one with the other PRs the searches missed, in one request", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    await added(user.id);

    const { requests } = await sync(
      user.id,
      {
        statuses: { PR_1: searchHit("PR_1"), PR_9: hit() },
        prs: details,
      },
      hours(1),
    );
    const statusRequests = requests.filter(
      (r) => r.variables.ids && !r.query.includes("reviewThreads"),
    );
    expect(statusRequests).toHaveLength(1);
    expect(statusIds(requests).toSorted()).toEqual(["PR_1", "PR_9"]);
  });

  it("syncs a user who watches no repos, without searching", async () => {
    const user = await makeUser();
    await db.watchedRepo.deleteMany();
    await added(user.id);

    const { requests } = await sync(user.id, {
      statuses: { PR_9: hit() },
      prs: details,
    });
    expect(searchQueries(requests)).toEqual([]);
    expect(statusIds(requests)).toEqual(["PR_9"]);
    expect((await row()).title).toBe("Add search");
  });
});

const items = () => db.item.findMany({ orderBy: { kind: "asc" } });
const openItemCount = () => db.item.count({ where: { status: "open" } });
const itemOf = async (kind: string) =>
  db.item.findFirstOrThrow({ where: { kind } });
// The items `asked` makes: a review request, a reply, and a mention.
const ASKED_ITEMS = 3;
// GitHub with PR_1 asking octocat to review. See `githubPr` for what else it has.
const asked = (pr = githubPr(), updatedAt = "2026-10-21T10:00:00Z") => ({
  reviewRequested: [searchHit("PR_1", { repoId: WATCHED, updatedAt })],
  prs: { PR_1: { ...pr, updatedAt } },
});

describe("items", () => {
  it("saves what the rules find on each fetched PR", async () => {
    const user = await makeUser();
    const { result } = await sync(user.id, asked());

    const pr = await db.pullRequest.findFirstOrThrow();
    const saved = await items();
    // The fixture asks octocat to review, and has a bot reply to octocat's thread
    // comment and a mention after it.
    expect(saved).toMatchObject([
      {
        userId: user.id,
        pullRequestId: pr.id,
        kind: "mention",
        dedupeKey: "mention:PR_1",
        latestEventId: "IC_1",
        eventCount: 1,
        actorLogin: "ghost",
        occurredAt: new Date("2026-10-21T09:30:00Z"),
        waitingSince: null,
        status: "open",
        seenAt: null,
      },
      {
        kind: "reply",
        dedupeKey: "reply:PR_1",
        latestEventId: "C_2",
        eventCount: 1,
        actorLogin: "renovate",
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
    const mention = await itemOf("mention");
    await db.item.updateMany({ data: { seenAt: NOW } });

    // The PR changed on GitHub, but nothing new for the user.
    const same = await sync(user.id, asked(githubPr(), "2026-10-21T11:00:00Z"));
    expect(same.result.newEventItemIds).toEqual([]);
    expect((await itemOf("mention")).seenAt).toEqual(NOW);

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
    const pinged = await sync(user.id, asked(pr, "2026-10-21T12:00:00Z"));
    expect(pinged.result.newEventItemIds).toEqual([mention.id]);
    expect(await itemOf("mention")).toMatchObject({
      latestEventId: "IC_2",
      eventCount: 2,
      seenAt: null,
    });
  });

  it("marks items from bots, filling in older ones without notifying", async () => {
    const user = await makeUser();
    const pr = githubPr({
      comments: {
        nodes: githubPr().comments.nodes.map((comment) => ({
          ...comment,
          author: { __typename: "Bot", login: "ci-bot" },
        })),
      },
    });
    await sync(user.id, asked(pr));
    expect(await itemOf("mention")).toMatchObject({ actorIsBot: true });

    // Like an item saved before items knew about bots.
    await db.item.updateMany({ data: { actorIsBot: false } });
    const { result } = await sync(user.id, asked(pr, "2026-10-21T11:00:00Z"));
    expect(result.newEventItemIds).toEqual([]);
    expect(await itemOf("mention")).toMatchObject({ actorIsBot: true });
  });

  it("resolves items once you act on them", async () => {
    const user = await makeUser();
    await sync(user.id, asked());

    const pr = githubPr();
    pr.reviewRequests.nodes = [];
    pr.reviews.nodes.push({
      id: "R_3",
      state: "APPROVED",
      submittedAt: "2026-10-21T10:30:00Z",
      bodyText: "",
      author: { __typename: "User", login: "octocat" },
    });
    const later = hours(1);
    await sync(user.id, asked(pr, "2026-10-21T10:30:00Z"), later);

    expect(await items()).toMatchObject([
      { kind: "mention", status: "resolved", resolvedAt: later },
      { kind: "reply", status: "resolved", resolvedAt: later },
      { kind: "review_requested", status: "resolved", resolvedAt: later },
    ]);
  });

  it("keeps a review request you only commented on, waiting on the author", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    const before = await itemOf("review_requested");

    // GitHub drops the request after a "Comment" review. The author answers.
    const answer = {
      id: "IC_2",
      author: { __typename: "User", login: "sam" },
      bodyText: "Fixed it",
      createdAt: "2026-10-21T10:40:00Z",
    };
    const commented = (...comments: (typeof answer)[]) => {
      const pr = githubPr({
        comments: { nodes: [...githubPr().comments.nodes, ...comments] },
      });
      pr.reviewRequests.nodes = [];
      pr.reviews.nodes.push({
        id: "R_3",
        state: "COMMENTED",
        submittedAt: "2026-10-21T10:30:00Z",
        bodyText: "",
        author: { __typename: "User", login: "octocat" },
      });
      return asked(pr, comments.at(-1)?.createdAt ?? "2026-10-21T10:30:00Z");
    };

    const waiting = await sync(user.id, commented(), hours(1));
    expect(waiting.result.newEventItemIds).toEqual([]);
    expect(await itemOf("review_requested")).toMatchObject({
      id: before.id,
      status: "open",
      waitingOnAuthor: true,
      waitingSince: null,
    });

    // The author answers. That's a reply. The request keeps waiting until they ask again.
    const answered = await sync(user.id, commented(answer), hours(2));
    const replyItem = await itemOf("reply");
    expect(answered.result.newEventItemIds).toEqual([replyItem.id]);
    expect(replyItem).toMatchObject({ status: "open", latestEventId: "IC_2" });
    expect(await itemOf("review_requested")).toMatchObject({
      latestEventId: "RRE_1",
      waitingOnAuthor: true,
    });

    // You answer back. The reply is done, and the request still waits.
    const reply = {
      ...answer,
      id: "IC_3",
      author: { __typename: "User", login: "octocat" },
      createdAt: "2026-10-21T10:50:00Z",
    };
    const again = await sync(user.id, commented(answer, reply), hours(3));
    expect(again.result.newEventItemIds).toEqual([]);
    expect(await itemOf("reply")).toMatchObject({ status: "resolved" });
    expect(await itemOf("review_requested")).toMatchObject({
      latestEventId: "RRE_1",
      waitingOnAuthor: true,
    });
  });

  it("keeps items when a search misses a PR that's still open", async () => {
    const user = await makeUser();
    await sync(user.id, asked());

    const { result } = await sync(
      user.id,
      { statuses: { PR_1: searchHit("PR_1") } },
      hours(1),
    );
    expect(result.ended).toBe(0);
    expect(await openItemCount()).toBe(ASKED_ITEMS);
  });

  it.each([
    ["merged", { PR_1: searchHit("PR_1", { state: "MERGED" }) }],
    ["closed", { PR_1: searchHit("PR_1", { state: "CLOSED" }) }],
    ["gone", {}],
  ])("resolves items when the PR is %s", async (state, statuses) => {
    const user = await makeUser();
    await sync(user.id, asked());

    const { result } = await sync(user.id, { statuses }, hours(1));
    expect(result.ended).toBe(1);
    expect(await openItemCount()).toBe(0);
    expect((await db.pullRequest.findFirstOrThrow()).state).toBe(state);
  });

  it("lists important PRs that merge, once, and saves when", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    await db.pullRequest.updateMany({ data: { importantAt: NOW } });

    const merged = {
      statuses: { PR_1: searchHit("PR_1", { state: "MERGED" }) },
    };
    const { result } = await sync(user.id, merged, hours(1));
    const pr = await db.pullRequest.findFirstOrThrow();
    expect(result.mergedImportantPrIds).toEqual([pr.id]);
    expect(pr.mergedAt).toEqual(hours(1));

    // Ended PRs aren't checked again.
    const again = await sync(user.id, merged, hours(2));
    expect(again.result.mergedImportantPrIds).toEqual([]);
  });

  it("doesn't list PRs that merge unmarked, or close", async () => {
    const user = await makeUser();
    await sync(user.id, {
      reviewRequested: [
        searchHit("PR_1", { repoId: WATCHED }),
        searchHit("PR_2", { repoId: WATCHED }),
      ],
      prs: { PR_1: githubPr(), PR_2: githubPr({ id: "PR_2" }) },
    });
    await db.pullRequest.updateMany({
      where: { githubNodeId: "PR_2" },
      data: { importantAt: NOW },
    });

    const { result } = await sync(
      user.id,
      {
        statuses: {
          PR_1: searchHit("PR_1", { state: "MERGED" }),
          PR_2: searchHit("PR_2", { state: "CLOSED" }),
        },
      },
      hours(1),
    );
    expect(result.ended).toBe(2);
    expect(result.mergedImportantPrIds).toEqual([]);
  });

  it("reopens items without notifying when a closed PR opens again", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    const closed = { PR_1: searchHit("PR_1", { state: "CLOSED" }) };
    await sync(user.id, { statuses: closed }, hours(1));

    const { result } = await sync(user.id, asked(), hours(2));
    expect(await openItemCount()).toBe(ASKED_ITEMS);
    expect(result.newEventItemIds).toEqual([]);
    expect((await db.pullRequest.findFirstOrThrow()).state).toBe("open");
  });

  it("resolves items when the PR's repo is paused, and reopens them when it's back", async () => {
    const user = await makeUser();
    await sync(user.id, asked());

    await db.watchedRepo.updateMany({
      where: { githubRepoId: WATCHED },
      data: { enabled: false },
    });
    const paused = await sync(user.id, {}, hours(1));
    expect(paused.github).not.toHaveBeenCalled();
    expect(await openItemCount()).toBe(0);
    expect((await db.pullRequest.findFirstOrThrow()).state).toBe("unwatched");

    await db.watchedRepo.updateMany({ data: { enabled: true } });
    const back = await sync(user.id, asked(), hours(2));
    expect(await openItemCount()).toBe(ASKED_ITEMS);
    expect(back.result.newEventItemIds).toEqual([]);
  });

  it("lists a PR only the mentions search finds", async () => {
    const user = await makeUser();
    const pr = githubPr({
      reviewRequests: { nodes: [] },
      reviewThreads: { nodes: [] },
      bodyText: "cc @octocat",
    });
    await sync(user.id, {
      mentioned: [searchHit("PR_1", { repoId: WATCHED })],
      prs: { PR_1: pr },
    });
    expect((await items()).map((item) => item.kind)).toEqual(["mention"]);
    expect(await itemOf("mention")).toMatchObject({
      latestEventId: "IC_1",
      eventCount: 2,
    });
  });

  describe("assigned PRs", () => {
    // PR_1 with only octocat assigned, by `by`, and nothing else for them.
    const assignedPr = (by: string) =>
      githubPr({
        reviewRequests: { nodes: [] },
        reviewThreads: { nodes: [] },
        comments: { nodes: [] },
        assignees: { nodes: [{ login: "octocat" }] },
        assignEvents: {
          nodes: [
            {
              __typename: "AssignedEvent",
              id: "AE_2",
              createdAt: "2026-10-21T09:00:00Z",
              actor: { __typename: "User", login: by },
              assignee: { __typename: "User", login: "octocat" },
            },
          ],
        },
      });
    const assignedSearch = (pr: unknown) => ({
      assigned: [searchHit("PR_1", { repoId: WATCHED })],
      prs: { PR_1: pr },
    });

    it("lists a PR only the assignee search finds, and notifies", async () => {
      const user = await makeUser();
      const { result } = await sync(user.id, assignedSearch(assignedPr("sam")));

      const item = await itemOf("assigned");
      expect(item).toMatchObject({
        dedupeKey: "as:PR_1:AE_2",
        actorLogin: "sam",
        summary: "sam assigned you",
        waitingSince: new Date("2026-10-21T09:00:00Z"),
        seenAt: null,
      });
      expect(result.newEventItemIds).toEqual([item.id]);
    });

    it("saves assigning yourself as seen, without notifying", async () => {
      const user = await makeUser();
      const { result } = await sync(
        user.id,
        assignedSearch(assignedPr("octocat")),
      );

      expect(await itemOf("assigned")).toMatchObject({ seenAt: NOW });
      expect(result.newEventItemIds).toEqual([]);
    });

    it("resolves the item when you're unassigned", async () => {
      const user = await makeUser();
      await sync(user.id, assignedSearch(assignedPr("sam")));

      const updatedAt = "2026-10-21T11:00:00Z";
      await sync(
        user.id,
        {
          assigned: [searchHit("PR_1", { repoId: WATCHED, updatedAt })],
          prs: {
            PR_1: { ...assignedPr("sam"), assignees: { nodes: [] }, updatedAt },
          },
        },
        hours(1),
      );
      expect(await openItemCount()).toBe(0);
    });
  });

  it("skips rules the user turned off", async () => {
    const user = await makeUser();
    await db.ruleSetting.update({
      where: { userId_ruleId: { userId: user.id, ruleId: "review_requested" } },
      data: { enabled: false },
    });
    await sync(user.id, asked());
    expect((await items()).map((item) => item.kind)).toEqual([
      "mention",
      "reply",
    ]);
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
    // The fixture's only reply is from a bot.
    expect(await db.item.count({ where: { kind: "reply" } })).toBe(0);
  });

  it("makes an item when one of the user's teams is asked to review", async () => {
    const user = await makeUser();
    const frontend = { __typename: "Team", combinedSlug: "acme/frontend" };
    const pr = githubPr({
      reviewRequests: { nodes: [{ requestedReviewer: frontend }] },
      timelineItems: {
        nodes: [
          {
            __typename: "ReviewRequestedEvent",
            id: "RRE_team",
            createdAt: "2026-10-21T08:15:00Z",
            requestedReviewer: frontend,
          },
        ],
      },
    });
    await sync(user.id, { ...asked(pr), teams: ["acme/frontend"] });

    expect(await itemOf("review_requested")).toMatchObject({
      dedupeKey: "rr:PR_1:RRE_team",
      summary: "Review requested from acme/frontend",
    });
  });

  it("doesn't ask for the user's teams with team requests off", async () => {
    const user = await makeUser();
    await db.userSettings.update({
      where: { userId: user.id },
      data: { includeTeamRequests: false },
    });
    const { requests } = await sync(user.id, asked());
    expect(teamQueries(requests)).toBe(0);
  });

  it("writes nothing when nothing changed", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    const before = await items();

    await sync(user.id, asked(), hours(1));
    expect(await items()).toEqual(before);
  });

  it("asks for the user's teams at most once an hour", async () => {
    const user = await makeUser();
    // The fixture asks a team to review.
    const first = await sync(user.id, asked());
    const soon = await sync(user.id, asked(), hours(0.5));
    const later = await sync(user.id, asked(), hours(1.5));
    expect(teamQueries(first.requests)).toBe(1);
    expect(teamQueries(soon.requests)).toBe(0);
    expect(teamQueries(later.requests)).toBe(1);
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

  it("tells listeners when a PR with no open items ends", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    await db.item.updateMany({ data: { status: "resolved" } });
    const listener = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await listener.connect();
    try {
      const payloads: string[] = [];
      listener.on("notification", (msg) => payloads.push(msg.payload ?? ""));
      await listener.query(`LISTEN ${ITEMS_CHANNEL}`);

      // Gone from GitHub.
      await sync(user.id, {}, hours(1));
      await vi.waitFor(() => expect(payloads).toEqual([user.id]));
    } finally {
      await listener.end();
    }
  });
});

describe("quiet PRs", () => {
  const quietAt = async () => (await db.pullRequest.findFirstOrThrow()).quietAt;
  const hush = () => db.pullRequest.updateMany({ data: { quietAt: NOW } });

  // PR_1 with one push, `sha`, and no checks.
  const pushed = (sha: string, overrides: Record<string, unknown> = {}) =>
    githubPr({
      recentCommits: {
        nodes: [recentCommit(sha, "2026-10-21T07:00:00Z", null)],
      },
      commits: {
        nodes: [
          {
            commit: {
              oid: sha,
              committedDate: "2026-10-21T07:00:00Z",
              statusCheckRollup: null,
            },
          },
        ],
      },
      ...overrides,
    });
  const own = (sha: string, updatedAt = "2026-10-21T10:00:00Z") => ({
    authored: [searchHit("PR_1", { repoId: WATCHED, updatedAt })],
    prs: {
      PR_1: {
        ...pushed(sha, { author: { __typename: "User", login: "octocat" } }),
        updatedAt,
      },
    },
  });

  it("stays quiet when nothing new happens", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    await hush();

    await sync(user.id, asked(githubPr(), "2026-10-21T11:00:00Z"), hours(1));
    expect(await quietAt()).toEqual(NOW);
  });

  it("wakes when something new happens on it", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    await hush();

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
    const { result } = await sync(
      user.id,
      asked(pr, "2026-10-21T12:00:00Z"),
      hours(1),
    );
    expect(result.newEventItemIds).toHaveLength(1);
    expect(await quietAt()).toBeNull();
  });

  it("wakes the user's own PR on new commits", async () => {
    const user = await makeUser();
    await sync(user.id, own("abc123"));
    await hush();

    const { result } = await sync(
      user.id,
      own("def456", "2026-10-21T11:00:00Z"),
      hours(1),
    );
    // Only the push is new.
    expect(result.newEventItemIds).toEqual([]);
    expect(await quietAt()).toBeNull();
  });

  it("keeps other people's PRs quiet on new commits", async () => {
    const user = await makeUser();
    await sync(user.id, asked(pushed("abc123")));
    await hush();

    const { result } = await sync(
      user.id,
      asked(pushed("def456"), "2026-10-21T11:00:00Z"),
      hours(1),
    );
    expect(result.newEventItemIds).toEqual([]);
    expect(await quietAt()).toEqual(NOW);
  });
});

describe("full passes", () => {
  // A setting that changes what the rules find was saved at `at`.
  const settingChanged = (userId: string, at: Date) =>
    db.user.update({ where: { id: userId }, data: { rulesStaleAt: at } });

  it("runs one on the first sync, then only fetches PRs that changed", async () => {
    const user = await makeUser();
    const first = await sync(user.id, asked());
    expect(first.result.fullPass).toBe(true);
    expect((await db.user.findFirstOrThrow()).rulesRunAt).toEqual(NOW);

    const next = await sync(user.id, asked(), hours(1));
    expect(next.result.fullPass).toBe(false);
  });

  it("runs one after a deploy, and heals an item without notifying", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    // Like an old bug resolving it by mistake.
    await db.item.updateMany({ data: { status: "resolved", resolvedAt: NOW } });

    // A PR that didn't change keeps its items between full passes.
    await sync(user.id, asked(), hours(1));
    expect(await openItemCount()).toBe(0);

    // The worker restarted at 1:30, with a deploy.
    const { result, requests } = await sync(
      user.id,
      asked(),
      hours(2),
      hours(1.5),
    );
    expect(result.fullPass).toBe(true);
    expect(detailIds(requests)).toEqual(["PR_1"]);
    expect(await openItemCount()).toBe(ASKED_ITEMS);
    expect(result.newEventItemIds).toEqual([]);
  });

  it("applies a rule being turned off, or back on", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    const where = { userId_ruleId: { userId: user.id, ruleId: "reply" } };

    await db.ruleSetting.update({ where, data: { enabled: false } });
    await settingChanged(user.id, hours(0.5));
    await sync(user.id, asked(), hours(1));
    expect(await itemOf("reply")).toMatchObject({
      status: "resolved",
      resolvedAt: hours(1),
    });
    expect((await itemOf("review_requested")).status).toBe("open");

    await db.ruleSetting.update({ where, data: { enabled: true } });
    await settingChanged(user.id, hours(1.5));
    await sync(user.id, asked(), hours(2));
    expect((await itemOf("reply")).status).toBe("open");
  });

  it("applies hiding bots", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    await db.userSettings.update({
      where: { userId: user.id },
      data: { hideBots: true },
    });
    await settingChanged(user.id, hours(0.5));

    await sync(user.id, asked(), hours(1));
    // The fixture's only reply is from a bot.
    expect((await itemOf("reply")).status).toBe("resolved");
  });

  it("still runs for a setting saved while a sync ran", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    await settingChanged(user.id, hours(1));

    // Started before the setting was saved, so it ran on the old one.
    await sync(user.id, asked(), hours(0.9));
    const { result } = await sync(user.id, asked(), hours(2));
    expect(result.fullPass).toBe(true);
  });

  it("runs one when the user's teams change", async () => {
    const user = await makeUser();
    // Only the team acme/frontend is asked to review.
    const frontend = { __typename: "Team", combinedSlug: "acme/frontend" };
    const pr = githubPr({
      reviewRequests: { nodes: [{ requestedReviewer: frontend }] },
    });
    await sync(user.id, asked(pr));
    expect(await db.item.count({ where: { kind: "review_requested" } })).toBe(
      0,
    );

    // The user joined the team. The PR didn't change.
    const later = { ...asked(pr), teams: ["acme/frontend"] };
    const { result } = await sync(user.id, later, hours(1.5));
    expect(result.fullPass).toBe(true);
    expect((await itemOf("review_requested")).status).toBe("open");
    expect((await db.user.findFirstOrThrow()).teams).toEqual(["acme/frontend"]);
  });

  it("keeps a team change for the next sync when this one fails", async () => {
    const user = await makeUser();
    const frontend = { __typename: "Team", combinedSlug: "acme/frontend" };
    const pr = githubPr({
      reviewRequests: { nodes: [{ requestedReviewer: frontend }] },
    });
    await sync(user.id, asked(pr));

    // The user joined the team, but the searches fail after the teams are checked.
    const joined = { ...asked(pr), teams: ["acme/frontend"] };
    const answer = prGitHub(joined);
    const { octokit } = fakeGraphQL((request) =>
      request.query.includes("search(")
        ? {
            data: null,
            errors: [{ type: "INTERNAL", message: "GitHub broke" }],
          }
        : answer(request),
    );
    await expect(
      syncUser(
        { db, github: () => Promise.resolve(octokit), now: () => hours(1.5) },
        user.id,
      ),
    ).rejects.toThrow();

    const { result } = await sync(user.id, joined, hours(1.6));
    expect(result.fullPass).toBe(true);
    expect((await itemOf("review_requested")).status).toBe("open");
  });

  it("leaves PRs that ended alone", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    // Gone from GitHub.
    await sync(user.id, {}, hours(1));
    await settingChanged(user.id, hours(1.5));

    await sync(user.id, {}, hours(2));
    expect(await openItemCount()).toBe(0);
  });
});

describe("refreshTokenOwners", () => {
  it("runs at the start of a sync, for users with a token", async () => {
    const user = await makeUser();
    const token = await addToken(db, user.id, "github_pat_acme");
    const { octokit } = fakeGraphQL(prGitHub({}), 0, ["acme"]);
    const github = vi.fn(() => Promise.resolve(octokit));

    await syncUser({ db, github, now: () => NOW }, user.id);

    expect(github).toHaveBeenCalledWith(user.id, { tokenId: token.id });
    expect(
      (await db.gitHubToken.findUniqueOrThrow({ where: { id: token.id } }))
        .owners,
    ).toEqual(["acme"]);
  });

  it("isn't asked for by a sync of a user with no token", async () => {
    const user = await makeUser();
    const { github } = await sync(user.id, {});
    expect(github).toHaveBeenCalledTimes(1);
    expect(github).toHaveBeenCalledWith(user.id, { tokenId: null });
  });

  it("saves the owners of fine-grained tokens never checked or a day old", async () => {
    const user = await makeUser();
    const fresh = await addToken(db, user.id, "github_pat_fresh", {
      owners: ["kept"],
      ownersCheckedAt: hours(-1),
    });
    const stale = await addToken(db, user.id, "github_pat_stale", {
      ownersCheckedAt: hours(-25),
    });
    const copied = await addToken(db, user.id, "github_pat_copied", {
      kind: null,
    });
    await addToken(db, user.id, "ghp_classic");
    await addToken(db, user.id, "github_pat_stopped", { status: "stopped" });
    const github = vi.fn(() =>
      Promise.resolve(reposGitHub([["acme"]]).octokit),
    );

    await refreshTokenOwners({ db, github }, user.id, NOW);

    expect(github.mock.calls).toEqual(
      expect.arrayContaining([
        [user.id, { tokenId: stale.id }],
        [user.id, { tokenId: copied.id }],
      ]),
    );
    expect(github).toHaveBeenCalledTimes(2);
    const byId = async (id: string) =>
      db.gitHubToken.findUniqueOrThrow({ where: { id } });
    expect(await byId(stale.id)).toMatchObject({
      owners: ["acme"],
      ownersCheckedAt: NOW,
    });
    expect((await byId(fresh.id)).owners).toEqual(["kept"]);
  });

  it("skips a token GitHub rejects, and keeps going", async () => {
    const user = await makeUser();
    const bad = await addToken(db, user.id, "github_pat_bad");
    const good = await addToken(db, user.id, "github_pat_good");
    const rejected = new RequestError("Bad credentials", 401, {
      request: { method: "GET", url: "/user/repos", headers: {} },
    });
    const github = vi.fn((_userId: string, choice?: TokenChoice) =>
      choice && "tokenId" in choice && choice.tokenId === bad.id
        ? Promise.reject(rejected)
        : Promise.resolve(reposGitHub([["acme"]]).octokit),
    );

    await refreshTokenOwners({ db, github }, user.id, NOW);

    expect(
      (await db.gitHubToken.findUniqueOrThrow({ where: { id: good.id } }))
        .owners,
    ).toEqual(["acme"]);
  });
});

describe("several tokens", () => {
  const { makePr } = itemRows(db);
  const GLOBEX = 10;
  const INITECH = 20;
  const prIn = (id: string, owner: string) =>
    githubPr({
      id,
      repository: { name: "app", owner: { login: owner } },
    });

  // A user who watches acme/web-app (from makeUser), globex/app, and initech/app, with
  // a fine-grained token for acme and one for globex. Nothing reaches initech.
  async function setup() {
    const user = await makeUser();
    await db.watchedRepo.createMany({
      data: [
        { userId: user.id, githubRepoId: GLOBEX, owner: "globex", name: "app" },
        {
          userId: user.id,
          githubRepoId: INITECH,
          owner: "initech",
          name: "app",
        },
      ],
    });
    const fresh = { ownersCheckedAt: NOW };
    const acme = await addToken(db, user.id, "github_pat_acme", {
      owners: ["acme"],
      createdAt: hours(-2),
      ...fresh,
    });
    const globex = await addToken(db, user.id, "github_pat_globex", {
      owners: ["globex"],
      createdAt: hours(-1),
      ...fresh,
    });
    return { user, acme, globex };
  }

  // A fake GitHub for each token, by id. "signIn" is the sign in's. Syncs always say
  // which token they want.
  function githubs(fakes: Record<string, FakePrGitHub>) {
    const made = Object.fromEntries(
      Object.entries(fakes).map(([key, fake]) => [
        key,
        fakeGraphQL(prGitHub(fake)),
      ]),
    );
    const github = vi.fn((_userId: string, choice?: TokenChoice) => {
      const key =
        choice && "tokenId" in choice ? (choice.tokenId ?? "signIn") : "";
      const fake = made[key];
      return fake
        ? Promise.resolve(fake.octokit)
        : Promise.reject(new Error(`no fake for ${key}`));
    });
    return { github, requestsOf: (key: string) => made[key]!.requests };
  }

  it("syncs each owner with its token, searching once per token", async () => {
    const { user, acme, globex } = await setup();
    const { github, requestsOf } = githubs({
      [acme.id]: {
        reviewRequested: [searchHit("PR_A", { repoId: WATCHED })],
        prs: { PR_A: prIn("PR_A", "acme") },
      },
      [globex.id]: {
        reviewRequested: [searchHit("PR_G", { repoId: GLOBEX })],
        prs: { PR_G: prIn("PR_G", "globex") },
      },
      signIn: {
        reviewRequested: [searchHit("PR_I", { repoId: INITECH })],
        prs: { PR_I: prIn("PR_I", "initech") },
      },
    });

    await syncUser({ db, github, now: () => NOW }, user.id);

    const saved = await db.pullRequest.findMany({
      orderBy: { githubNodeId: "asc" },
    });
    expect(saved.map((pr) => pr.githubNodeId)).toEqual([
      "PR_A",
      "PR_G",
      "PR_I",
    ]);
    // Each token makes its two searches and fetches only its owner's PRs.
    for (const [key, id] of [
      [acme.id, "PR_A"],
      [globex.id, "PR_G"],
      ["signIn", "PR_I"],
    ] as const) {
      expect(searchQueries(requestsOf(key))).toHaveLength(2);
      expect(detailIds(requestsOf(key))).toEqual([id]);
    }
  });

  it("syncs a stopped token's owners with the sign in", async () => {
    const { user, acme, globex } = await setup();
    await db.gitHubToken.update({
      where: { id: globex.id },
      data: { status: "stopped" },
    });
    const { github } = githubs({
      [acme.id]: {},
      signIn: {
        reviewRequested: [searchHit("PR_G", { repoId: GLOBEX })],
        prs: { PR_G: prIn("PR_G", "globex") },
      },
    });

    await syncUser({ db, github, now: () => NOW }, user.id);

    expect(github).not.toHaveBeenCalledWith(user.id, { tokenId: globex.id });
    expect(
      await db.pullRequest.count({ where: { githubNodeId: "PR_G" } }),
    ).toBe(1);
  });

  it("checks a PR added by its link with the token for its owner", async () => {
    const { user, acme, globex } = await setup();
    // Added from a globex repo the user doesn't watch, and missed by the searches.
    await makePr(user.id, 9, {
      githubRepoId: 99,
      repoOwner: "globex",
      addedAt: hours(-1),
    });
    const { github, requestsOf } = githubs({
      [acme.id]: {},
      [globex.id]: {
        statuses: { PR_9: searchHit("PR_9", { repoId: 99 }) },
        prs: { PR_9: prIn("PR_9", "globex") },
      },
      signIn: {},
    });

    await syncUser({ db, github, now: () => NOW }, user.id);

    expect(statusIds(requestsOf(globex.id))).toEqual(["PR_9"]);
    expect(detailIds(requestsOf(globex.id))).toEqual(["PR_9"]);
  });

  it("keeps syncing with the tokens when the sign in stops working", async () => {
    const { user, acme, globex } = await setup();
    // On the list from before, in initech, which only the sign in reaches.
    await makePr(user.id, 5, { githubRepoId: INITECH, repoOwner: "initech" });
    const { github } = githubs({
      [acme.id]: {
        reviewRequested: [searchHit("PR_A", { repoId: WATCHED })],
        prs: { PR_A: prIn("PR_A", "acme") },
      },
      [globex.id]: {},
    });
    const signInStopped = vi.fn((userId: string, choice?: TokenChoice) =>
      choice && "tokenId" in choice && choice.tokenId === null
        ? Promise.reject(new NeedsReauthError(userId))
        : github(userId, choice),
    );

    await syncUser({ db, github: signInStopped, now: () => NOW }, user.id);

    expect(
      await db.pullRequest.count({ where: { githubNodeId: "PR_A" } }),
    ).toBe(1);
    // Left as it was: not ended for want of an answer.
    expect(
      (
        await db.pullRequest.findFirstOrThrow({
          where: { githubNodeId: "PR_5" },
        })
      ).state,
    ).toBe("open");
  });

  it("doesn't try a sign in that stopped working, while a token works", async () => {
    const { user, acme, globex } = await setup();
    await db.user.update({
      where: { id: user.id },
      data: { signInStoppedAt: hours(-1) },
    });
    const { github } = githubs({ [acme.id]: {}, [globex.id]: {} });

    await syncUser({ db, github, now: () => NOW }, user.id);

    expect(github).not.toHaveBeenCalledWith(user.id, { tokenId: null });
  });
});
