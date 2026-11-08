import {
  MAX_TOKENS,
  type CheckTokenResponse,
  type MeResponse,
  type TokenResponse,
  type TokensResponse,
} from "@pr-peek/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  APP_URL,
  bodyOf,
  makeTestApp,
  signIn,
  type Agent,
} from "../../test/app";
import { createTestDb, resetDb } from "../../test/db";
import { fakeOAuth, githubUser, hours, TEST_KEY } from "../../test/fakes";
import { decrypt } from "../crypto";
import {
  type CheckedToken,
  GitHubAuthError,
  type GitHubOAuth,
} from "../github/oauth";
import { githubTokenRouter } from "./github-token";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

// GitHub reports a pasted token with these details.
const tokenIs =
  (checked: Partial<CheckedToken> = {}): GitHubOAuth["checkToken"] =>
  () =>
    Promise.resolve({
      user: githubUser(),
      scopes: ["repo", "read:org"],
      expiresAt: hours(24 * 30),
      ...checked,
    });

function makeApp(checkToken = tokenIs()) {
  const oauth = fakeOAuth({ checkToken });
  const { agent } = makeTestApp(db, {
    oauth,
    routers: [githubTokenRouter({ db, oauth, key: TEST_KEY })],
  });
  return { agent, oauth };
}

async function setup(checkToken?: GitHubOAuth["checkToken"]) {
  const app = makeApp(checkToken);
  await signIn(app.agent);
  return app;
}

const user = () => db.user.findFirstOrThrow();
const check = (agent: Agent, token = "ghp_token") =>
  agent.post("/api/github-tokens/check").set("Origin", APP_URL).send({ token });

it("needs sign in", async () => {
  const { agent, oauth } = makeApp();
  expect((await agent.get("/api/github-tokens")).status).toBe(401);
  expect((await check(agent)).status).toBe(401);
  expect(oauth.checkToken).not.toHaveBeenCalled();
});

// Checking, adding, and replacing all check the pasted token the same way.
describe("a pasted token", () => {
  it("is refused when it's from another GitHub account", async () => {
    const { agent } = await setup(
      tokenIs({ user: githubUser({ id: 99, login: "someone-else" }) }),
    );
    const res = await check(agent);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "wrong_account" } });
  });

  it("is refused when GitHub doesn't accept it", async () => {
    const { agent } = await setup(() =>
      Promise.reject(new GitHubAuthError("bad_token", "Bad credentials")),
    );
    const res = await check(agent);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "bad_token" } });
  });

  it.each([
    [["repo"], 200],
    [["public_repo"], 200],
    [["read:org"], 400],
  ])("with scopes %o answers %i", async (scopes, status) => {
    const { agent } = await setup(tokenIs({ scopes }));
    expect((await check(agent)).status).toBe(status);
  });

  it("isn't asked about when it doesn't look like a token", async () => {
    const { agent, oauth } = await setup();
    for (const token of ["", "has spaces in it", "x".repeat(256)]) {
      const res = await check(agent, token);
      expect(res.body).toMatchObject({ error: { code: "invalid_input" } });
    }
    expect(oauth.checkToken).not.toHaveBeenCalled();
  });

  it("is blocked from other sites", async () => {
    const { agent, oauth } = await setup();
    const res = await agent
      .post("/api/github-tokens/check")
      .set("Origin", "https://evil.example")
      .send({ token: "ghp_token" });
    expect(res.status).toBe(403);
    expect(oauth.checkToken).not.toHaveBeenCalled();
  });

  it("is checked at most 30 times in a row", async () => {
    const { agent } = await setup();
    for (let i = 0; i < 30; i++) await check(agent);
    expect((await check(agent)).status).toBe(429);
  });
});

// The routes for several tokens.
const addToken = (agent: Agent, token: string, name?: string) =>
  agent
    .post("/api/github-tokens")
    .set("Origin", APP_URL)
    .send({ token, ...(name && { name }) });
const replaceToken = (agent: Agent, id: string, token: string, name?: string) =>
  agent
    .put(`/api/github-tokens/${id}`)
    .set("Origin", APP_URL)
    .send({ token, ...(name && { name }) });
const removeToken = (agent: Agent, id: string) =>
  agent.delete(`/api/github-tokens/${id}`).set("Origin", APP_URL);

// GitHub reports a fine-grained token that reaches `owners`.
function fineGrained(owners: string[]) {
  return fakeOAuth({
    checkToken: tokenIs({ scopes: null }),
    tokenOwners: () => Promise.resolve(owners),
  });
}

async function setupWith(oauth: ReturnType<typeof fakeOAuth>) {
  const { agent } = makeTestApp(db, {
    oauth,
    routers: [githubTokenRouter({ db, oauth, key: TEST_KEY })],
  });
  await signIn(agent);
  const me = await user();
  await db.watchedRepo.create({
    data: { userId: me.id, githubRepoId: 1, owner: "acme", name: "web-app" },
  });
  return { agent, oauth, userId: me.id };
}

describe("GET /api/github-tokens", () => {
  it("lists the tokens, and which syncs each watched owner", async () => {
    const { agent, userId } = await setupWith(fineGrained(["acme"]));
    await db.watchedRepo.create({
      data: { userId, githubRepoId: 2, owner: "globex", name: "app" },
    });
    const { id } = bodyOf<TokenResponse>(
      await addToken(agent, "github_pat_acme"),
    ).token;

    const res = bodyOf<TokensResponse>(await agent.get("/api/github-tokens"));
    expect(res.tokens).toEqual([
      expect.objectContaining({
        id,
        name: "acme",
        kind: "fine_grained",
        owners: ["acme"],
        status: "working",
      }),
    ]);
    expect(res.syncedBy).toEqual([
      { owner: "acme", repos: 1, tokenId: id },
      { owner: "globex", repos: 1, tokenId: null },
    ]);
  });
});

describe("POST /api/github-tokens/check", () => {
  it("says what a token reaches, without saving it", async () => {
    const { agent } = await setupWith(fineGrained(["acme"]));
    const res = await check(agent, "github_pat_acme");

    expect(res.status).toBe(200);
    expect(bodyOf<CheckTokenResponse>(res)).toEqual({
      kind: "fine_grained",
      owners: ["acme"],
      scopes: [],
      expiresAt: hours(24 * 30).toISOString(),
      name: "acme",
      sameOwnersAs: null,
      reachesWatched: true,
    });
    expect(await db.gitHubToken.count()).toBe(0);
  });

  it("points out a token the user has that reaches the same owners", async () => {
    const { agent } = await setupWith(fineGrained(["Acme"]));
    const first = bodyOf<TokenResponse>(
      await addToken(agent, "github_pat_one"),
    );
    const res = bodyOf<CheckTokenResponse>(
      await check(agent, "github_pat_two"),
    );
    expect(res.sameOwnersAs).toBe(first.token.id);
  });

  it("says when it reaches no watched repo", async () => {
    const { agent } = await setupWith(fineGrained(["initech"]));
    const res = bodyOf<CheckTokenResponse>(
      await check(agent, "github_pat_initech"),
    );
    expect(res.reachesWatched).toBe(false);
  });

  it("says when the token is already added", async () => {
    const { agent } = await setupWith(fineGrained(["acme"]));
    await addToken(agent, "github_pat_acme");
    const res = await check(agent, "github_pat_acme");
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: "already_added" } });
  });
});

describe("POST /api/github-tokens", () => {
  it("adds tokens next to each other, named after what they reach", async () => {
    const { agent, oauth } = await setupWith(fineGrained(["acme"]));
    const res = await addToken(agent, "github_pat_acme");
    expect(res.status).toBe(201);
    await addToken(agent, "ghp_classic", "Everything");

    const tokens = await db.gitHubToken.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(tokens.map((t) => [t.name, t.kind])).toEqual([
      ["acme", "fine_grained"],
      ["Everything", "classic"],
    ]);
    expect(decrypt(tokens[0]!.tokenEnc, TEST_KEY)).toBe("github_pat_acme");
    expect(tokens[0]!.ownersCheckedAt).toBeInstanceOf(Date);
    // Only the fine-grained one: a classic token reaches every owner.
    expect(oauth.tokenOwners).toHaveBeenCalledTimes(1);
  });

  it("refuses a sixth token, and the same token twice", async () => {
    const { agent } = await setupWith(fineGrained(["acme"]));
    for (let i = 0; i < MAX_TOKENS; i++) {
      expect((await addToken(agent, `github_pat_${i}`)).status).toBe(201);
    }
    const sixth = await addToken(agent, "github_pat_6");
    expect(sixth.status).toBe(409);
    expect(sixth.body).toMatchObject({ error: { code: "too_many" } });

    const again = await addToken(agent, "github_pat_0");
    expect(again.body).toMatchObject({ error: { code: "already_added" } });
  });

  it("restarts syncs that were stopped", async () => {
    const { agent } = await setupWith(fineGrained(["acme"]));
    await db.user.updateMany({
      data: { syncError: "token", syncFailures: 2, syncRetryAt: hours(1) },
    });
    await addToken(agent, "github_pat_acme");
    expect(await user()).toMatchObject({
      syncError: null,
      syncFailures: 0,
      syncRetryAt: null,
    });
  });
});

describe("PUT /api/github-tokens/:id", () => {
  it("replaces a token in place, keeping its name, even at the cap", async () => {
    const { agent } = await setupWith(fineGrained(["acme"]));
    const ids: string[] = [];
    for (let i = 0; i < MAX_TOKENS; i++) {
      ids.push(
        bodyOf<TokenResponse>(await addToken(agent, `github_pat_${i}`)).token
          .id,
      );
    }
    const id = ids[0]!;
    await db.gitHubToken.update({
      where: { id },
      data: { status: "stopped", name: "Work" },
    });

    const res = await replaceToken(agent, id, "github_pat_new");
    expect(res.status).toBe(200);
    const saved = await db.gitHubToken.findUniqueOrThrow({ where: { id } });
    expect(saved).toMatchObject({ name: "Work", status: "working" });
    expect(decrypt(saved.tokenEnc, TEST_KEY)).toBe("github_pat_new");
    expect(await db.gitHubToken.count()).toBe(MAX_TOKENS);

    await replaceToken(agent, id, "github_pat_newer", "Work 2");
    expect(
      (await db.gitHubToken.findUniqueOrThrow({ where: { id } })).name,
    ).toBe("Work 2");
  });

  it("only replaces the user's own tokens", async () => {
    const { agent } = await setupWith(fineGrained(["acme"]));
    const res = await replaceToken(agent, "someone-elses", "github_pat_new");
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/github-tokens/:id", () => {
  it("removes one token, and restarts syncs when another still works", async () => {
    const { agent } = await setupWith(fineGrained(["acme"]));
    const stopped = bodyOf<TokenResponse>(
      await addToken(agent, "github_pat_a"),
    );
    const working = bodyOf<TokenResponse>(
      await addToken(agent, "github_pat_b"),
    );
    await db.gitHubToken.update({
      where: { id: stopped.token.id },
      data: { status: "stopped" },
    });
    await db.user.updateMany({ data: { syncError: "token" } });

    expect((await removeToken(agent, stopped.token.id)).status).toBe(204);
    expect((await db.gitHubToken.findMany()).map((t) => t.id)).toEqual([
      working.token.id,
    ]);
    expect((await user()).syncError).toBeNull();

    const me = bodyOf<MeResponse>(await agent.get("/api/me"));
    expect(me.githubTokens.map((t) => t.id)).toEqual([working.token.id]);
  });

  it("only removes the user's own tokens", async () => {
    const { agent } = await setupWith(fineGrained(["acme"]));
    expect((await removeToken(agent, "someone-elses")).status).toBe(404);
  });
});
