import {
  MAX_WATCHED_REPOS,
  type RepoOwnersResponse,
  type SearchReposResponse,
  type WatchedRepoDto,
} from "@pr-peek/core";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_URL, bodyOf, makeTestApp, signIn } from "../../test/app";
import { addToken, createTestDb, resetDb } from "../../test/db";
import { NOW } from "../../test/fakes";
import {
  fakeGraphQL,
  notFoundError,
  type GraphQLRequest,
} from "../../test/github";
import type { GitHubFor } from "../github/client";
import { NeedsReauthError } from "../github/tokens";
import { PICKER_ASKS_PER_MINUTE, reposRouter } from "./repos";

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
  isFork: false,
  pushedAt: "2026-11-01T00:00:00Z",
  ...extra,
});

const option = (id: number, name: string, extra: object = {}) => ({
  githubRepoId: id,
  owner: "acme",
  name,
  isPrivate: false,
  isFork: false,
  pushedAt: "2026-11-01T00:00:00Z",
  ...extra,
});

// Answers like GitHub: the repo lists, owners, search, and single repo lookups.
function github(request: GraphQLRequest) {
  const page = (nodes: unknown[]) => ({
    nodes,
    pageInfo: { hasNextPage: true, endCursor: "cursor-2" },
  });
  if (request.query.includes("organizations")) {
    return {
      data: {
        viewer: {
          login: "octocat",
          organizations: { nodes: [{ login: "zeta" }, { login: "Acme" }] },
          repositories: {
            nodes: [
              { owner: { login: "octocat" } },
              { owner: { login: "acme" } },
              { owner: { login: "dana" } },
              { owner: { login: "bo" } },
              { owner: { login: "dana" } },
            ],
          },
        },
      },
    };
  }
  if (request.query.includes("repositoryOwner")) {
    if (request.variables.owner === "nobody") {
      return { data: { repositoryOwner: null } };
    }
    return {
      data: {
        repositoryOwner: {
          repositories: page([repo(4, "fork", { isFork: true })]),
        },
      },
    };
  }
  if (request.query.includes("viewer")) {
    return {
      data: {
        viewer: {
          repositories: page([
            repo(1, "web-app"),
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

async function setup(
  answer: (request: GraphQLRequest) => unknown = github,
  delayMs = 0,
) {
  const fake = fakeGraphQL(answer, delayMs);
  const githubFor = vi.fn<GitHubFor>(() => Promise.resolve(fake.octokit));
  const { agent } = makeTestApp(db, {
    routers: [reposRouter({ db, github: githubFor })],
  });
  await signIn(agent);
  return { agent, githubFor, requests: fake.requests };
}

const add = (agent: Awaited<ReturnType<typeof setup>>["agent"], name: string) =>
  agent.post("/api/repos").set("Origin", APP_URL).send({ owner: "acme", name });

describe("GET /api/github/repos", () => {
  it("lists the user's repos", async () => {
    const { agent } = await setup();

    const res = await agent.get("/api/github/repos");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      repos: [option(1, "web-app"), option(3, "api", { isPrivate: true })],
      // With no owner, the cursor also says which token's list it's in.
      nextCursor: "0:cursor-2",
    });
  });

  it("asks only by owner affiliation, so org members' own repos stay out", async () => {
    const { agent, requests } = await setup();
    await agent.get("/api/github/repos");

    const query = requests.at(-1)?.query ?? "";
    expect(query).toContain(
      "ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]",
    );
    expect(query).not.toMatch(/\baffiliations:/);
    expect(query).toContain("first: 100");
    expect(query).toContain("isArchived: false");
  });

  it("lists one owner's repos, and passes the cursor along", async () => {
    const { agent, githubFor, requests } = await setup();

    const res = await agent.get("/api/github/repos?owner=acme&cursor=abc");
    expect(res.status).toBe(200);
    // With the token that reaches that owner.
    expect(githubFor).toHaveBeenCalledWith(expect.any(String), {
      owner: "acme",
    });
    expect(res.body).toEqual({
      repos: [option(4, "fork", { isFork: true })],
      nextCursor: "cursor-2",
    });
    expect(requests.at(-1)?.variables).toEqual({
      owner: "acme",
      cursor: "abc",
    });
  });

  it("answers 404 for an owner GitHub doesn't know", async () => {
    const { agent } = await setup();

    const res = await agent.get("/api/github/repos?owner=nobody");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "not_found" } });
  });

  it("refuses an owner that isn't a valid GitHub name", async () => {
    const { agent } = await setup();

    const res = await agent.get("/api/github/repos?owner=a%20b");
    expect(res.status).toBe(400);
  });

  it("searches by name when given a query, and passes the cursor along", async () => {
    const { agent, requests } = await setup();
    const res = await agent.get("/api/github/repos?query=web&cursor=0:abc");

    expect(bodyOf<SearchReposResponse>(res).repos).toHaveLength(1);
    expect(requests.at(-1)?.variables).toEqual({
      q: "web in:name archived:false",
      cursor: "abc",
    });
  });

  it("searches only one owner's repos when given an owner", async () => {
    const { agent, requests } = await setup();
    await agent.get("/api/github/repos?query=web&owner=acme");

    expect(requests.at(-1)?.variables).toEqual({
      q: "web in:name archived:false user:acme",
      cursor: null,
    });
  });

  it(`stops after ${PICKER_ASKS_PER_MINUTE} asks a minute, to save the user's GitHub budget`, async () => {
    const { agent, requests } = await setup();
    for (let i = 0; i < PICKER_ASKS_PER_MINUTE; i++) {
      await agent.get(i % 2 ? "/api/github/repos" : "/api/github/owners");
    }

    const res = await agent.get("/api/github/repos");
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: { code: "rate_limited" } });
    expect(requests).toHaveLength(PICKER_ASKS_PER_MINUTE);
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

describe("an org that blocks Git Buddy", () => {
  const blocked = { type: "FORBIDDEN", message: "OAuth App access restricted" };

  it("leaves out its repos and keeps the rest of the list", async () => {
    const { agent } = await setup(() => ({
      data: {
        viewer: {
          repositories: {
            nodes: [repo(1, "web-app"), null],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
      errors: [blocked],
    }));

    const res = await agent.get("/api/github/repos");
    expect(res.status).toBe(200);
    expect(bodyOf<SearchReposResponse>(res).repos).toEqual([
      option(1, "web-app"),
    ]);
  });

  it("leaves it out of the owners", async () => {
    const { agent } = await setup(() => ({
      data: {
        viewer: {
          login: "octocat",
          organizations: { nodes: [{ login: "acme" }, null] },
          repositories: { nodes: [] },
        },
      },
      errors: [blocked],
    }));

    const res = await agent.get("/api/github/owners");
    expect(res.body).toEqual({
      owners: [
        { login: "octocat", kind: "you" },
        { login: "acme", kind: "org" },
      ],
    });
  });

  it("still fails on other errors", async () => {
    const { agent } = await setup(() => ({
      data: null,
      errors: [{ type: "INTERNAL", message: "Something went wrong" }],
    }));

    expect((await agent.get("/api/github/owners")).status).toBe(500);
  });
});

describe("GET /api/github/owners", () => {
  it("lists the user, their orgs, then owners who share repos, each by name", async () => {
    const { agent } = await setup();

    const res = await agent.get("/api/github/owners");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      owners: [
        { login: "octocat", kind: "you" },
        { login: "Acme", kind: "org" },
        { login: "zeta", kind: "org" },
        { login: "bo", kind: "shared" },
        { login: "dana", kind: "shared" },
      ],
    });
  });
});

describe("with personal access tokens", () => {
  // GitHub's answer with the sign in's repos on one page, no more after it.
  const onePage = (request: GraphQLRequest) =>
    request.query.includes("viewer") && !request.query.includes("organizations")
      ? {
          data: {
            viewer: {
              repositories: {
                nodes: [repo(1, "web-app")],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }
      : github(request);

  it("lists the repos of every token, one after another, with no owner picked", async () => {
    const { agent, githubFor } = await setup(onePage);
    const user = await db.user.findFirstOrThrow();
    const token = await addToken(db, user.id, "github_pat_globex");

    const first = bodyOf<SearchReposResponse>(
      await agent.get("/api/github/repos"),
    );
    expect(first.nextCursor).toBe("1:");
    expect(githubFor).toHaveBeenLastCalledWith(user.id, { tokenId: null });

    const second = bodyOf<SearchReposResponse>(
      await agent.get("/api/github/repos?cursor=1:"),
    );
    expect(second.repos).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(githubFor).toHaveBeenLastCalledWith(user.id, { tokenId: token.id });
  });

  it("skips a token GitHub refuses, so the others still list", async () => {
    const { agent, githubFor } = await setup(onePage);
    const user = await db.user.findFirstOrThrow();
    await addToken(db, user.id, "github_pat_globex");
    githubFor.mockImplementation((_userId, choice) =>
      choice && "tokenId" in choice && choice.tokenId
        ? Promise.reject(new NeedsReauthError(user.id, "token"))
        : Promise.resolve(fakeGraphQL(onePage).octokit),
    );

    const res = await agent.get("/api/github/repos?cursor=1:");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ repos: [], nextCursor: null });
  });

  it("ends the list for a cursor past the last token, like one removed meanwhile", async () => {
    const { agent, githubFor } = await setup(onePage);
    const res = await agent.get("/api/github/repos?cursor=3:abc");
    expect(res.body).toEqual({ repos: [], nextCursor: null });
    expect(githubFor).not.toHaveBeenCalled();
  });

  it("leaves out a sign in that stopped, while a token works", async () => {
    const { agent, githubFor } = await setup(onePage);
    const user = await db.user.findFirstOrThrow();
    const token = await addToken(db, user.id, "github_pat_globex");
    await db.user.update({
      where: { id: user.id },
      data: { signInStoppedAt: NOW },
    });

    const res = bodyOf<SearchReposResponse>(
      await agent.get("/api/github/repos"),
    );
    expect(githubFor).toHaveBeenCalledExactlyOnceWith(user.id, {
      tokenId: token.id,
    });
    expect(res.nextCursor).toBeNull();
  });

  it("lists orgs with the sign in, which sees them all, not a newer fine-grained token", async () => {
    const { agent, githubFor } = await setup();
    const user = await db.user.findFirstOrThrow();
    await addToken(db, user.id, "github_pat_globex", { owners: ["globex"] });

    await agent.get("/api/github/owners");
    expect(githubFor).toHaveBeenCalledExactlyOnceWith(user.id, {
      tokenId: null,
    });
  });

  it("offers the tokens' orgs when GitHub refuses the sign in", async () => {
    const { agent, githubFor } = await setup();
    const user = await db.user.findFirstOrThrow();
    await addToken(db, user.id, "github_pat_globex", { owners: ["globex"] });
    githubFor.mockRejectedValue(new NeedsReauthError(user.id));

    const res = await agent.get("/api/github/owners");
    expect(res.status).toBe(200);
    expect(bodyOf<RepoOwnersResponse>(res).owners).toEqual([
      { login: user.login, kind: "you" },
      { login: "globex", kind: "org" },
    ]);
  });

  it("offers the orgs working tokens reach, next to the ones GitHub lists", async () => {
    const { agent } = await setup();
    const user = await db.user.findFirstOrThrow();
    await addToken(db, user.id, "github_pat_a", { owners: ["globex", "acme"] });
    await addToken(db, user.id, "github_pat_b", {
      owners: ["initech"],
      status: "stopped",
    });

    const { owners } = bodyOf<RepoOwnersResponse>(
      await agent.get("/api/github/owners"),
    );
    expect(owners.filter((o) => o.kind === "org")).toEqual([
      { login: "Acme", kind: "org" },
      { login: "globex", kind: "org" },
      { login: "zeta", kind: "org" },
    ]);
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
      color: null,
      colorOn: false,
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

  it("keeps a repo's color while its color is turned off", async () => {
    const { agent, id } = await withRepo();
    const patch = (body: object) =>
      agent.patch(`/api/repos/${id}`).set("Origin", APP_URL).send(body);

    const on = await patch({ colorOn: true, color: "#e11d48" });
    expect(bodyOf<OneRepo>(on).repo).toMatchObject({
      colorOn: true,
      color: "#e11d48",
    });
    const off = await patch({ colorOn: false });
    expect(bodyOf<OneRepo>(off).repo).toMatchObject({
      colorOn: false,
      color: "#e11d48",
    });
    expect((await patch({ color: "red" })).status).toBe(400);
    expect((await patch({ color: null })).status).toBe(400);
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
    for (const path of [
      "/api/repos",
      "/api/github/repos",
      "/api/github/owners",
    ]) {
      expect((await agent.get(path)).status).toBe(401);
    }
  });
});
