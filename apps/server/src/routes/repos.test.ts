import {
  MAX_WATCHED_REPOS,
  type SearchReposResponse,
  type WatchedRepoDto,
} from "@pr-peek/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { APP_URL, bodyOf, makeTestApp, signIn } from "../../test/app";
import { createTestDb, resetDb } from "../../test/db";
import {
  fakeGraphQL,
  notFoundError,
  type GraphQLRequest,
} from "../../test/github";
import { NeedsReauthError } from "../github/tokens";
import { reposRouter } from "./repos";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

type OneRepo = { repo: WatchedRepoDto };
type RepoList = { repos: WatchedRepoDto[] };

const repo = (id: number, name: string, extra: object = {}) => ({
  databaseId: id,
  name,
  owner: { login: "acme" },
  isPrivate: false,
  isArchived: false,
  ...extra,
});

// Answers like GitHub: the repo list, search, and single repo lookups.
function github(request: GraphQLRequest) {
  const page = (nodes: unknown[]) => ({
    nodes,
    pageInfo: { hasNextPage: true, endCursor: "cursor-2" },
  });
  if (request.query.includes("viewer")) {
    return {
      data: {
        viewer: {
          repositories: page([
            repo(1, "web-app"),
            repo(2, "old-thing", { isArchived: true }),
            repo(3, "api", { isPrivate: true }),
          ]),
        },
      },
    };
  }
  if (request.query.includes("search")) {
    return { data: { search: page([repo(1, "web-app"), {}]) } };
  }
  if (request.variables.name === "missing") return notFoundError;
  return { data: { repository: repo(1, String(request.variables.name)) } };
}

async function setup(answer = github, delayMs = 0) {
  const fake = fakeGraphQL(answer, delayMs);
  const { agent } = makeTestApp(db, {
    routers: [reposRouter({ db, github: () => Promise.resolve(fake.octokit) })],
  });
  await signIn(agent);
  return { agent, requests: fake.requests };
}

const add = (agent: Awaited<ReturnType<typeof setup>>["agent"], name: string) =>
  agent.post("/api/repos").set("Origin", APP_URL).send({ owner: "acme", name });

describe("GET /api/github/repos", () => {
  it("lists the user's repos, skipping archived ones and marking watched ones", async () => {
    const { agent } = await setup();
    await add(agent, "web-app");

    const res = await agent.get("/api/github/repos");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      repos: [
        {
          githubRepoId: 1,
          owner: "acme",
          name: "web-app",
          isPrivate: false,
          watched: true,
        },
        {
          githubRepoId: 3,
          owner: "acme",
          name: "api",
          isPrivate: true,
          watched: false,
        },
      ],
      nextCursor: "cursor-2",
    });
  });

  it("searches by name when given a query, and passes the cursor along", async () => {
    const { agent, requests } = await setup();
    const res = await agent.get("/api/github/repos?query=web&cursor=abc");

    expect(bodyOf<SearchReposResponse>(res).repos).toHaveLength(1);
    expect(requests.at(-1)?.variables).toEqual({
      q: "web in:name archived:false",
      cursor: "abc",
    });
  });

  it("asks the user to sign in again if their GitHub token is gone", async () => {
    const { agent } = makeTestApp(db, {
      routers: [
        reposRouter({
          db,
          github: (id) => Promise.reject(new NeedsReauthError(id)),
        }),
      ],
    });
    await signIn(agent);

    const res = await agent.get("/api/github/repos");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: "reauth" } });
  });
});

describe("POST /api/repos", () => {
  it("adds a repo to the watch list", async () => {
    const { agent } = await setup();

    const res = await add(agent, "web-app");
    expect(res.status).toBe(201);
    expect(bodyOf<OneRepo>(res).repo).toMatchObject({
      githubRepoId: 1,
      owner: "acme",
      name: "web-app",
      enabled: true,
      muted: false,
    });

    const list = await agent.get("/api/repos");
    expect(bodyOf<RepoList>(list).repos).toHaveLength(1);
  });

  it("refuses a repo that's already watched", async () => {
    const { agent } = await setup();
    await add(agent, "web-app");
    const res = await add(agent, "web-app");
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: "already_watched" } });
  });

  it("answers 409, not 500, when the same repo is added twice at once", async () => {
    // Slow GitHub answers, so both requests pass the "already watched?" check together.
    const { agent } = await setup(github, 50);
    const statuses = (
      await Promise.all([add(agent, "web-app"), add(agent, "web-app")])
    ).map((res) => res.status);
    expect(statuses.sort()).toEqual([201, 409]);
  });

  it("refuses a repo that doesn't exist or the user can't see", async () => {
    const { agent } = await setup();
    const res = await add(agent, "missing");
    expect(res.status).toBe(404);
  });

  it("refuses names that aren't valid GitHub names", async () => {
    const { agent } = await setup();
    const res = await add(agent, "../etc");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "invalid_input" } });
  });

  it(`stops at ${MAX_WATCHED_REPOS} repos`, async () => {
    const { agent } = await setup();
    const user = await db.user.findFirstOrThrow();
    await db.watchedRepo.createMany({
      data: Array.from({ length: MAX_WATCHED_REPOS }, (_, i) => ({
        userId: user.id,
        githubRepoId: 1000 + i,
        owner: "acme",
        name: `repo-${i}`,
      })),
    });

    const res = await add(agent, "web-app");
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: "too_many_repos" } });
  });
});

describe("PATCH and DELETE /api/repos/:id", () => {
  async function withRepo() {
    const ctx = await setup();
    const res = await add(ctx.agent, "web-app");
    return { ...ctx, id: bodyOf<OneRepo>(res).repo.id };
  }

  it("mutes and disables a repo", async () => {
    const { agent, id } = await withRepo();
    const res = await agent
      .patch(`/api/repos/${id}`)
      .set("Origin", APP_URL)
      .send({ muted: true, enabled: false });
    expect(res.status).toBe(200);
    expect(bodyOf<OneRepo>(res).repo).toMatchObject({
      muted: true,
      enabled: false,
    });
  });

  it("rejects an empty update", async () => {
    const { agent, id } = await withRepo();
    const res = await agent
      .patch(`/api/repos/${id}`)
      .set("Origin", APP_URL)
      .send({});
    expect(res.status).toBe(400);
  });

  it("removes a repo", async () => {
    const { agent, id } = await withRepo();
    const res = await agent.delete(`/api/repos/${id}`).set("Origin", APP_URL);
    expect(res.status).toBe(204);
    expect(bodyOf<RepoList>(await agent.get("/api/repos")).repos).toEqual([]);
  });

  it("can't touch another user's repo", async () => {
    const { id } = await withRepo();
    const other = await db.user.create({
      data: { githubId: 99, login: "someone-else" },
    });
    await db.watchedRepo.update({ where: { id }, data: { userId: other.id } });

    const { agent } = await setup();
    const patch = await agent
      .patch(`/api/repos/${id}`)
      .set("Origin", APP_URL)
      .send({ muted: true });
    const del = await agent.delete(`/api/repos/${id}`).set("Origin", APP_URL);
    expect(patch.status).toBe(404);
    expect(del.status).toBe(404);
  });
});

describe("signed out", () => {
  it("can't use any repo route", async () => {
    const { agent } = makeTestApp(db, {
      routers: [
        reposRouter({ db, github: () => Promise.reject(new Error("unused")) }),
      ],
    });
    for (const path of ["/api/repos", "/api/github/repos"]) {
      expect((await agent.get(path)).status).toBe(401);
    }
  });
});
