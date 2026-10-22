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
  statusIds,
  teamQueries,
  type FakePrGitHub,
} from "../test/pulls";
import { ITEMS_CHANNEL, rerunRules } from "./items";
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
    expect(searchQueries(requests)).toHaveLength(4);
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
    });
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

  it("resolves items once you act on them", async () => {
    const user = await makeUser();
    await sync(user.id, asked());

    const pr = githubPr();
    pr.reviewRequests.nodes = [];
    pr.reviews.nodes.push({
      id: "R_3",
      state: "COMMENTED",
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

  it("heals an item resolved by mistake on the next sync, without notifying", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    // Like an old bug, or a deploy changeover, resolving it.
    await db.item.updateMany({ data: { status: "resolved", resolvedAt: NOW } });

    // The PR didn't change on GitHub, so its details aren't fetched again.
    const { result, requests } = await sync(user.id, asked(), hours(1));
    expect(detailIds(requests)).toEqual([]);
    expect(await openItemCount()).toBe(ASKED_ITEMS);
    expect(result.newEventItemIds).toEqual([]);
  });

  it("applies a rule turned back on to PRs that didn't change", async () => {
    const user = await makeUser();
    const where = {
      userId_ruleId: { userId: user.id, ruleId: "mention" as const },
    };
    await db.ruleSetting.update({ where, data: { enabled: false } });
    await sync(user.id, asked());
    expect(await db.item.count({ where: { kind: "mention" } })).toBe(0);

    await db.ruleSetting.update({ where, data: { enabled: true } });
    await sync(user.id, asked(), hours(1));
    expect((await itemOf("mention")).status).toBe("open");
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
});

describe("rerunRules", () => {
  // Runs the rules again an hour after the sync, with a fake GitHub for the teams query.
  async function rerun(userId: string, teams: string[] = []) {
    const { octokit, requests } = fakeGraphQL(prGitHub({ teams }));
    await rerunRules(db, userId, () => Promise.resolve(octokit), hours(1));
    return requests;
  }

  it("applies a rule being turned off", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    await db.ruleSetting.update({
      where: { userId_ruleId: { userId: user.id, ruleId: "reply" } },
      data: { enabled: false },
    });

    await rerun(user.id);
    expect(await itemOf("reply")).toMatchObject({
      status: "resolved",
      resolvedAt: hours(1),
    });
    expect((await itemOf("review_requested")).status).toBe("open");
  });

  it("applies hiding bots", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    await db.userSettings.update({
      where: { userId: user.id },
      data: { hideBots: true },
    });

    await rerun(user.id);
    // The fixture's only reply is from a bot.
    expect((await itemOf("reply")).status).toBe("resolved");
  });

  it("leaves PRs that ended alone", async () => {
    const user = await makeUser();
    await sync(user.id, asked());
    // Gone from GitHub.
    await sync(user.id, {}, hours(1));

    await rerun(user.id);
    expect(await openItemCount()).toBe(0);
  });

  // The fixture asks a team to review. Re-runs happen an hour after `NOW`.
  it("uses the sync's team list within the hour", async () => {
    const user = await makeUser();
    await sync(user.id, asked(), hours(0.5));
    expect(await rerun(user.id)).toEqual([]);
  });

  it("only asks GitHub for the user's teams, and only when needed", async () => {
    const user = await makeUser();
    // The team list from this sync is an hour old at the re-run.
    await sync(user.id, asked());

    const requests = await rerun(user.id);
    expect(requests).toHaveLength(1);
    expect(teamQueries(requests)).toBe(1);

    await db.userSettings.update({
      where: { userId: user.id },
      data: { includeTeamRequests: false },
    });
    expect(await rerun(user.id)).toEqual([]);
  });

  it("does nothing before the first sync", async () => {
    const user = await makeUser();
    expect(await rerun(user.id)).toEqual([]);
    expect(await db.item.count()).toBe(0);
  });
});
