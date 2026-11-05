import type { PrPreviewResponse } from "@pr-peek/core";
import { afterAll, beforeEach, expect, it } from "vitest";
import { bodyOf, makeTestApp, signIn } from "../../test/app";
import { createTestDb, resetDb } from "../../test/db";
import {
  githubTokens,
  githubUser,
  hours,
  NOW,
  TEST_KEY,
} from "../../test/fakes";
import { fakeGraphQL, type GraphQLRequest } from "../../test/github";
import { itemRows } from "../../test/items";
import { checkContexts } from "../../test/pulls";
import { upsertGitHubUser } from "../users";
import { previewRouter } from "./preview";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const { makePr, makeItem } = itemRows(db);

const person = (login: string) => ({ __typename: "User", login });
const failed = (name: string) => ({
  __typename: "CheckRun",
  name,
  conclusion: "FAILURE",
});

// GitHub with one PR, PR_7, that has one comment, three people asked to review, and two
// failing checks.
function github(request: GraphQLRequest) {
  if (request.variables.id !== "PR_7") {
    return { data: { node: null }, errors: [{ type: "NOT_FOUND" }] };
  }
  return {
    data: {
      node: {
        bodyHTML: "<p>Adds login.</p>",
        createdAt: hours(-48).toISOString(),
        author: person("sam"),
        // The signed in user (octocat, in other capitals), someone else, and a team.
        reviewRequests: {
          nodes: [
            { requestedReviewer: person("OctoCat") },
            { requestedReviewer: person("dev-sam") },
            {
              requestedReviewer: {
                __typename: "Team",
                combinedSlug: "acme/web",
              },
            },
          ],
        },
        commits: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  contexts: checkContexts([failed("lint"), failed("e2e")]),
                },
              },
            },
          ],
        },
        comments: {
          nodes: [
            {
              id: "C_1",
              author: person("jordan"),
              bodyHTML: "<p>Can you check the migration?</p>",
              createdAt: hours(-3).toISOString(),
              isMinimized: false,
            },
          ],
        },
        reviews: { nodes: [] },
        reviewThreads: { nodes: [] },
      },
    },
  };
}

async function setup() {
  const fake = fakeGraphQL(github);
  const { agent } = makeTestApp(db, {
    routers: [
      previewRouter({
        db,
        github: () => Promise.resolve(fake.octokit),
        now: () => NOW,
      }),
    ],
  });
  await signIn(agent);
  const user = await db.user.findFirstOrThrow();
  return { agent, user, requests: fake.requests };
}

it("needs sign in", async () => {
  const { agent } = makeTestApp(db, {
    routers: [previewRouter({ db, github: () => Promise.reject(new Error()) })],
  });
  expect((await agent.get("/api/prs/x/preview")).status).toBe(401);
});

it("answers with the description, checks, reviewers, and comments, marking the item's", async () => {
  const { agent, user } = await setup();
  const pr = await makePr(user.id, 7);
  const item = await makeItem(user.id, pr.id, "commented", {
    latestEventId: "C_1",
  });

  const res = await agent.get(`/api/prs/${pr.id}/preview?item=${item.id}`);
  expect(res.status).toBe(200);
  expect(bodyOf<PrPreviewResponse>(res)).toEqual({
    bodyHtml: "<p>Adds login.</p>",
    openedAge: "2d",
    failingChecks: ["lint", "e2e"],
    reviewers: [
      { name: "OctoCat", isTeam: false, isYou: true, status: "requested" },
      { name: "dev-sam", isTeam: false, isYou: false, status: "requested" },
      { name: "acme/web", isTeam: true, isYou: false, status: "requested" },
    ],
    comments: [
      {
        id: "C_1",
        author: "jordan",
        bodyHtml: "<p>Can you check the migration?</p>",
        createdAt: hours(-3).toISOString(),
        age: "3h",
        where: null,
        reviewState: null,
      },
    ],
    focusId: "C_1",
  });
});

it("marks no comment without an item", async () => {
  const { agent, user } = await setup();
  const pr = await makePr(user.id, 7);

  const res = await agent.get(`/api/prs/${pr.id}/preview`);
  const body = bodyOf<PrPreviewResponse>(res);
  expect(body.comments).toHaveLength(1);
  expect(body.focusId).toBeNull();
});

it("ignores an item from another PR", async () => {
  const { agent, user } = await setup();
  const pr = await makePr(user.id, 7);
  const other = await makePr(user.id, 8);
  const item = await makeItem(user.id, other.id, "commented", {
    latestEventId: "C_1",
  });

  const res = await agent.get(`/api/prs/${pr.id}/preview?item=${item.id}`);
  expect(bodyOf<PrPreviewResponse>(res).focusId).toBeNull();
});

it("is 404 for another user's PR, without asking GitHub", async () => {
  const { agent, requests } = await setup();
  const { user: other } = await upsertGitHubUser(
    db,
    githubUser({ id: 43, login: "other" }),
    githubTokens(),
    TEST_KEY,
  );
  const pr = await makePr(other.id, 7);

  expect((await agent.get(`/api/prs/${pr.id}/preview`)).status).toBe(404);
  expect(requests).toHaveLength(0);
});

it("is 404 when the PR is gone from GitHub", async () => {
  const { agent, user } = await setup();
  const pr = await makePr(user.id, 8);
  expect((await agent.get(`/api/prs/${pr.id}/preview`)).status).toBe(404);
});
