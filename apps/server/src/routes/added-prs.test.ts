import {
  MAX_ADDED_PRS,
  type AddPrResponse,
  type PrLookupResponse,
} from "@pr-peek/core";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_URL,
  bodyOf,
  makeTestApp,
  signIn,
  type Agent,
} from "../../test/app";
import { createTestDb, resetDb } from "../../test/db";
import { hours, minutes, NOW } from "../../test/fakes";
import { fakeGraphQL, type GraphQLRequest } from "../../test/github";
import { itemRows } from "../../test/items";
import {
  githubPr,
  prGitHub,
  searchHit,
  type FakePrGitHub,
} from "../../test/pulls";
import { NEVER_SYNCED, syncUser } from "../sync";
import { addedPrsRouter } from "./added-prs";
import { itemsRouter } from "./items";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const { makePr } = itemRows(db);

// other/lib, a repo the user doesn't watch.
const REPO_ID = 3;
const LINK = "https://github.com/other/lib/pull/9";

// PR 9 in other/lib, as the lookup sees it.
const lookedUp = (fields: Record<string, unknown> = {}) => ({
  __typename: "PullRequest",
  id: "PR_9",
  number: 9,
  title: "Add search",
  url: LINK,
  isDraft: false,
  state: "OPEN",
  mergedAt: null,
  headRefOid: "abc123",
  author: { __typename: "User", login: "sam" },
  repository: { databaseId: REPO_ID, name: "lib", owner: { login: "other" } },
  ...fields,
});

// GitHub, where other/lib has PR 9 and issue 10. The sync's requests go to `sync`.
function github(pr = lookedUp(), sync: FakePrGitHub = {}) {
  const syncAnswer = prGitHub(sync);
  return (request: GraphQLRequest) => {
    if (!request.query.includes("issueOrPullRequest")) {
      return syncAnswer(request);
    }
    const { owner, name, number } = request.variables;
    const found =
      owner !== "other" || name !== "lib"
        ? undefined
        : number === 9
          ? pr
          : number === 10
            ? { __typename: "Issue" }
            : undefined;
    return found
      ? { data: { repository: { issueOrPullRequest: found } } }
      : {
          data: { repository: { issueOrPullRequest: null } },
          errors: [{ type: "NOT_FOUND" }],
        };
  };
}

async function setup(answer = github()) {
  const fake = fakeGraphQL(answer);
  const requestSync = vi.fn(() => Promise.resolve(true));
  const deps = {
    db,
    github: () => Promise.resolve(fake.octokit),
    requestSync,
    now: () => NOW,
  };
  const { agent } = makeTestApp(db, {
    routers: [addedPrsRouter(deps), itemsRouter(deps)],
  });
  await signIn(agent);
  const user = await db.user.findFirstOrThrow();
  return { agent, user, requestSync, requests: fake.requests };
}

const lookUp = (agent: Agent, link: string) =>
  agent.get("/api/prs/lookup").query({ link });
const add = (agent: Agent, link = LINK) =>
  agent.post("/api/prs").set("Origin", APP_URL).send({ link });
const row = () => db.pullRequest.findFirst({ where: { githubNodeId: "PR_9" } });

it("needs sign in", async () => {
  const { agent } = makeTestApp(db, {
    routers: [
      addedPrsRouter({
        db,
        github: () => Promise.reject(new Error()),
        requestSync: vi.fn(),
      }),
    ],
  });
  expect((await lookUp(agent, LINK)).status).toBe(401);
  expect((await add(agent)).status).toBe(401);
});

describe("GET /api/prs/lookup", () => {
  it("answers with the PR, from any link shape", async () => {
    const { agent } = await setup();
    for (const link of [LINK, `${LINK}/files`, "other/lib#9"]) {
      const res = await lookUp(agent, link);
      expect(bodyOf<PrLookupResponse>(res)).toEqual({
        owner: "other",
        repo: "lib",
        number: 9,
        title: "Add search",
        author: "sam",
        state: "open",
        tracked: false,
        flagged: false,
      });
    }
  });

  it("says when the user already tracks it, and whether it's flagged", async () => {
    const { agent, user } = await setup();
    await makePr(user.id, 9, { importantAt: hours(-1) });

    const body = bodyOf<PrLookupResponse>(await lookUp(agent, LINK));
    expect(body).toMatchObject({ tracked: true, flagged: true });
  });

  it.each([
    ["not a link", 400, "not_a_pr_link"],
    ["https://github.com/other/lib/pull/10", 422, "not_a_pr"],
    ["https://github.com/other/lib/pull/11", 404, "not_found"],
    ["https://github.com/other/hidden/pull/9", 404, "not_found"],
  ])("explains why %s can't be added", async (link, status, code) => {
    const { agent } = await setup();
    const res = await lookUp(agent, link);
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ error: { code } });
  });

  it("doesn't ask GitHub about text that isn't a link", async () => {
    const { agent, requests } = await setup();
    await lookUp(agent, "not a link");
    expect(requests).toHaveLength(0);
  });
});

describe("POST /api/prs", () => {
  it("adds the PR flagged, in Watching, and queues a sync", async () => {
    const { agent, user, requestSync } = await setup();
    const res = await add(agent);

    expect(res.status).toBe(201);
    const saved = await row();
    expect(bodyOf<AddPrResponse>(res)).toEqual({
      id: saved?.id,
      alreadyFlagged: false,
    });
    expect(saved).toMatchObject({
      githubRepoId: REPO_ID,
      repoOwner: "other",
      repoName: "lib",
      number: 9,
      title: "Add search",
      authorLogin: "sam",
      state: "open",
      importantAt: NOW,
      addedAt: NOW,
      listGroup: "watching",
      githubUpdatedAt: NEVER_SYNCED,
    });
    expect(requestSync).toHaveBeenCalledExactlyOnceWith(user.id);
  });

  it("adds a merged PR as merged", async () => {
    const mergedAt = hours(-2).toISOString();
    const { agent } = await setup(
      github(lookedUp({ state: "MERGED", mergedAt })),
    );
    await add(agent);
    expect(await row()).toMatchObject({
      state: "merged",
      mergedAt: new Date(mergedAt),
    });
  });

  it("flags a PR the user already tracks, without marking it added", async () => {
    const { agent, user, requestSync } = await setup();
    const tracked = await makePr(user.id, 9);

    const res = await add(agent);
    expect(res.status).toBe(200);
    expect(bodyOf<AddPrResponse>(res)).toEqual({
      id: tracked.id,
      alreadyFlagged: false,
    });
    expect(await row()).toMatchObject({ importantAt: NOW, addedAt: null });
    expect(requestSync).not.toHaveBeenCalled();

    // Again, and it says so.
    expect(bodyOf<AddPrResponse>(await add(agent)).alreadyFlagged).toBe(true);
  });

  it(`stops at ${MAX_ADDED_PRS} added PRs, merged ones too`, async () => {
    const { agent, user } = await setup();
    for (let n = 100; n < 100 + MAX_ADDED_PRS; n++) {
      await makePr(user.id, n, {
        addedAt: hours(-1),
        importantAt: hours(-1),
        ...(n === 100 && { state: "merged" as const }),
      });
    }

    const res = await add(agent);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: "too_many_added" } });
    expect(await row()).toBeNull();
  });

  it.each([
    ["not a link", 400, "not_a_pr_link"],
    ["https://github.com/other/lib/pull/10", 422, "not_a_pr"],
    ["https://github.com/other/lib/pull/11", 404, "not_found"],
  ])("explains why %s can't be added", async (link, status, code) => {
    const { agent } = await setup();
    const res = await add(agent, link);
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ error: { code } });
  });
});

describe("the syncs after", () => {
  // PR 9, as the sync sees it: open, and asking the user to review.
  const pr9 = { PR_9: githubPr({ id: "PR_9", number: 9 }) };
  const status9 = { PR_9: searchHit("PR_9", { repoId: REPO_ID }) };

  const sync = async (fake: FakePrGitHub, at: Date) => {
    const { octokit } = fakeGraphQL(github(lookedUp(), fake));
    const user = await db.user.findFirstOrThrow();
    return syncUser(
      { db, github: () => Promise.resolve(octokit), now: () => at },
      user.id,
    );
  };

  it("fill in a new PR's items, without pushing about old ones", async () => {
    const { agent } = await setup();
    await add(agent);

    const first = await sync({ statuses: status9, prs: pr9 }, minutes(1));
    expect(first.fetched).toBe(1);
    expect(first.newEventItemIds).toEqual([]);
    const items = await db.item.findMany();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.seenAt !== null)).toBe(true);
    expect((await row())?.githubUpdatedAt).not.toEqual(NEVER_SYNCED);

    // Later news pushes as usual.
    const updatedAt = "2026-10-21T12:00:00Z";
    const later = await sync(
      {
        statuses: { PR_9: searchHit("PR_9", { repoId: REPO_ID, updatedAt }) },
        prs: {
          PR_9: githubPr({
            id: "PR_9",
            number: 9,
            updatedAt,
            reviewRequests: { nodes: [] },
            comments: {
              nodes: [
                {
                  id: "IC_9",
                  author: { __typename: "User", login: "sam" },
                  bodyText: "@octocat can you look again?",
                  createdAt: updatedAt,
                },
              ],
            },
          }),
        },
      },
      hours(2),
    );
    expect(later.newEventItemIds).not.toEqual([]);
  });

  describe("unflagging an added PR", () => {
    const unflag = async (agent: Agent) => {
      const id = (await row())!.id;
      await agent.delete(`/api/prs/${id}/important`).set("Origin", APP_URL);
    };

    it("deletes it when the searches don't find it", async () => {
      const { agent } = await setup();
      await add(agent);
      await sync({ statuses: status9, prs: pr9 }, minutes(1));

      await unflag(agent);
      await sync({ statuses: status9 }, minutes(2));
      expect(await row()).toBeNull();
    });

    it("keeps it when the searches find it", async () => {
      const { agent, user } = await setup();
      await db.watchedRepo.create({
        data: {
          userId: user.id,
          githubRepoId: REPO_ID,
          owner: "other",
          name: "lib",
        },
      });
      await add(agent);
      await sync({ reviewRequested: [status9.PR_9], prs: pr9 }, minutes(1));

      await unflag(agent);
      await sync({ reviewRequested: [status9.PR_9] }, minutes(2));
      expect(await row()).toMatchObject({ addedAt: null, state: "open" });
    });

    it("keeps it while it has open items", async () => {
      const { agent, user } = await setup();
      await db.watchedRepo.create({
        data: {
          userId: user.id,
          githubRepoId: REPO_ID,
          owner: "other",
          name: "lib",
        },
      });
      await add(agent);
      await sync({ statuses: status9, prs: pr9 }, minutes(1));
      expect(
        await db.item.count({ where: { status: "open" } }),
      ).toBeGreaterThan(0);

      await unflag(agent);
      await sync({ statuses: status9 }, minutes(2));
      expect(await row()).not.toBeNull();
    });
  });
});
