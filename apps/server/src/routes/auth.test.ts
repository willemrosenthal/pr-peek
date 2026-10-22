import type request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { APP_URL, makeTestApp, signIn, startSignIn } from "../../test/app";
import { createTestDb, resetDb } from "../../test/db";
import { fakeOAuth, githubUser, hours, TEST_KEY } from "../../test/fakes";
import { decrypt } from "../crypto";
import { type CheckedToken, GitHubAuthError } from "../github/oauth";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const makeApp = (oauth = fakeOAuth()) => makeTestApp(db, { oauth });

const sessionCookie = (res: request.Response) =>
  (res.headers["set-cookie"] as string[] | undefined)?.[0]?.split(";")[0];

describe("starting sign in", () => {
  it("redirects to GitHub with a random state and our callback URL", async () => {
    const { agent, oauth } = makeApp();
    const state = await startSignIn(agent);

    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(oauth.authorizeUrl).toHaveBeenCalledWith({
      state,
      scope: "full",
      redirectUri: `${APP_URL}/api/auth/github/callback`,
    });
  });

  it("asks for public repos only when chosen", async () => {
    const { agent, oauth } = makeApp();
    await startSignIn(agent, "?scope=public");
    expect(oauth.authorizeUrl).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "public" }),
    );
  });

  it("slows down too many attempts", async () => {
    const { agent } = makeApp();
    for (let i = 0; i < 30; i++) await agent.get("/api/auth/github");
    const res = await agent.get("/api/auth/github");
    expect(res.status).toBe(429);
  });
});

describe("the GitHub callback", () => {
  it("signs in a new user and sends them to onboarding", async () => {
    const { agent, oauth } = makeApp();
    const res = await signIn(agent);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/onboarding");
    expect(oauth.exchangeCode).toHaveBeenCalledWith(
      "the-code",
      `${APP_URL}/api/auth/github/callback`,
    );

    const me = await agent.get("/api/me");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      user: {
        login: "octocat",
        authMethod: "oauth",
        scopes: ["repo", "read:org", "notifications"],
      },
      settings: { timezone: "UTC" },
      needsReauth: false,
    });
  });

  it("sends returning users to the list", async () => {
    await signIn(makeApp().agent);
    const res = await signIn(makeApp().agent);
    expect(res.headers.location).toBe("/");
  });

  it("gives the user a new session id when they sign in", async () => {
    const { agent } = makeApp();
    const start = await agent.get("/api/auth/github");
    const state = new URL(start.headers.location as string).searchParams.get(
      "state",
    );
    const callback = await agent.get(
      `/api/auth/github/callback?code=the-code&state=${state}`,
    );
    expect(sessionCookie(callback)).toBeDefined();
    expect(sessionCookie(callback)).not.toBe(sessionCookie(start));
  });

  it("rejects a state that doesn't match", async () => {
    const { agent, oauth } = makeApp();
    await startSignIn(agent);
    const res = await agent.get("/api/auth/github/callback?code=c&state=wrong");

    expect(res.headers.location).toBe("/signin?error=state");
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
    expect(await db.user.count()).toBe(0);
  });

  it("rejects a callback that wasn't started here", async () => {
    const { agent } = makeApp();
    const res = await agent.get(
      "/api/auth/github/callback?code=c&state=anything",
    );
    expect(res.headers.location).toBe("/signin?error=state");
  });

  it("only accepts each state once", async () => {
    const { agent } = makeApp();
    const state = await startSignIn(agent);
    await agent.get(`/api/auth/github/callback?code=c&state=wrong`);
    const retry = await agent.get(
      `/api/auth/github/callback?code=c&state=${state}`,
    );
    expect(retry.headers.location).toBe("/signin?error=state");
  });

  it("handles the user clicking Cancel on GitHub", async () => {
    const { agent } = makeApp();
    await startSignIn(agent);
    const res = await agent.get(
      "/api/auth/github/callback?error=access_denied",
    );
    expect(res.headers.location).toBe("/signin?error=denied");
  });

  it("handles GitHub rejecting the code", async () => {
    const { agent } = makeApp(
      fakeOAuth({
        exchangeCode: () =>
          Promise.reject(
            new GitHubAuthError("bad_verification_code", "expired"),
          ),
      }),
    );
    const res = await signIn(agent);
    expect(res.headers.location).toBe("/signin?error=github");
    expect(await db.user.count()).toBe(0);
  });
});

describe("POST /api/auth/token", () => {
  const postToken = (
    agent: ReturnType<typeof makeApp>["agent"],
    token = "ghp_token",
  ) => agent.post("/api/auth/token").set("Origin", APP_URL).send({ token });

  // An app where GitHub reports the pasted token with these details.
  const appWithToken = (checked: Partial<CheckedToken>) =>
    makeApp(
      fakeOAuth({
        checkToken: () =>
          Promise.resolve({
            user: githubUser(),
            scopes: ["repo"],
            expiresAt: null,
            ...checked,
          }),
      }),
    );

  it("signs in a new user with a personal access token", async () => {
    const { agent, oauth } = makeApp();
    const res = await postToken(agent, "  ghp_token  ");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isNew: true });
    expect(oauth.checkToken).toHaveBeenCalledWith("ghp_token");

    const me = await agent.get("/api/me");
    expect(me.body).toMatchObject({
      user: {
        login: "octocat",
        authMethod: "pat",
        scopes: ["repo", "read:org"],
      },
      needsReauth: false,
    });

    const user = await db.user.findFirstOrThrow();
    expect(user.accessTokenEnc).not.toContain("ghp_token");
    expect(decrypt(user.accessTokenEnc ?? "", TEST_KEY)).toBe("ghp_token");
    expect(user.accessTokenExpiresAt).toEqual(hours(24 * 30));
    expect(user.refreshTokenEnc).toBeNull();
  });

  it("replaces an OAuth sign in for the same GitHub account", async () => {
    const { agent } = makeApp();
    await signIn(agent);
    await db.user.updateMany({ data: { syncError: "reauth" } });

    const res = await postToken(agent);
    expect(res.body).toEqual({ isNew: false });

    const user = await db.user.findFirstOrThrow();
    expect(await db.user.count()).toBe(1);
    expect(user).toMatchObject({
      authMethod: "pat",
      refreshTokenEnc: null,
      refreshTokenExpiresAt: null,
      syncError: null,
    });
  });

  it("goes back to OAuth when the user later signs in with GitHub", async () => {
    const { agent } = makeApp();
    await postToken(agent);
    await signIn(agent);
    expect((await db.user.findFirstOrThrow()).authMethod).toBe("oauth");
  });

  it("accepts a fine-grained token, which has no scopes", async () => {
    const { agent } = appWithToken({ scopes: null });
    expect((await postToken(agent, "github_pat_token")).status).toBe(200);
    const user = await db.user.findFirstOrThrow();
    expect(user).toMatchObject({ tokenScopes: [], accessTokenExpiresAt: null });
  });

  it("rejects a token GitHub doesn't accept", async () => {
    const { agent } = makeApp(
      fakeOAuth({
        checkToken: () =>
          Promise.reject(new GitHubAuthError("bad_token", "Bad credentials")),
      }),
    );
    const res = await postToken(agent);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "bad_token" } });
    expect(await db.user.count()).toBe(0);
    expect((await agent.get("/api/me")).status).toBe(401);
  });

  it("rejects a classic token without the repo scope", async () => {
    const { agent } = appWithToken({ scopes: ["read:org"] });
    const res = await postToken(agent);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "missing_scope" } });
    expect(await db.user.count()).toBe(0);
  });

  it("accepts the public_repo scope", async () => {
    const { agent } = appWithToken({ scopes: ["public_repo"] });
    expect((await postToken(agent)).status).toBe(200);
  });

  it("rejects input that isn't a token, without asking GitHub", async () => {
    const { agent, oauth } = makeApp();
    for (const token of ["", "has spaces in it", "x".repeat(256)]) {
      const res = await postToken(agent, token);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: "invalid_input" } });
    }
    expect(oauth.checkToken).not.toHaveBeenCalled();
  });

  it("gives the user a new session id", async () => {
    const { agent } = makeApp();
    const start = await agent.get("/api/auth/github");
    const res = await postToken(agent);
    expect(sessionCookie(res)).toBeDefined();
    expect(sessionCookie(res)).not.toBe(sessionCookie(start));
  });

  it("is blocked from other sites", async () => {
    const { agent, oauth } = makeApp();
    const res = await agent
      .post("/api/auth/token")
      .set("Origin", "https://evil.example")
      .send({ token: "ghp_token" });
    expect(res.status).toBe(403);
    expect(oauth.checkToken).not.toHaveBeenCalled();
  });

  it("slows down too many attempts", async () => {
    const { agent } = makeApp();
    for (let i = 0; i < 30; i++) await postToken(agent);
    expect((await postToken(agent)).status).toBe(429);
  });
});

describe("GET /api/me", () => {
  it("returns 401 when signed out", async () => {
    const res = await makeApp().agent.get("/api/me");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("reports when the user needs to sign in again", async () => {
    const { agent } = makeApp();
    await signIn(agent);
    await db.user.updateMany({ data: { syncError: "reauth" } });

    const me = await agent.get("/api/me");
    expect(me.body).toMatchObject({ needsReauth: true });
  });

  it("records when the user last opened the app, at most hourly", async () => {
    const { agent } = makeApp();
    await signIn(agent);
    const lastActiveAt = async () =>
      (await db.user.findFirstOrThrow()).lastActiveAt;

    const recent = new Date(Date.now() - 10 * 60 * 1000);
    await db.user.updateMany({ data: { lastActiveAt: recent } });
    await agent.get("/api/me");
    expect(await lastActiveAt()).toEqual(recent);

    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await db.user.updateMany({ data: { lastActiveAt: old } });
    await agent.get("/api/me");
    expect((await lastActiveAt()).getTime()).toBeGreaterThan(old.getTime());
  });

  it("returns 401 if the user was deleted", async () => {
    const { agent } = makeApp();
    await signIn(agent);
    await db.user.deleteMany();

    expect((await agent.get("/api/me")).status).toBe(401);
  });
});

describe("POST /api/auth/signout", () => {
  it("ends the session", async () => {
    const { agent } = makeApp();
    await signIn(agent);

    const res = await agent.post("/api/auth/signout").set("Origin", APP_URL);
    expect(res.status).toBe(204);
    expect((await agent.get("/api/me")).status).toBe(401);
  });

  it("is blocked from other sites", async () => {
    const { agent } = makeApp();
    await signIn(agent);

    const res = await agent
      .post("/api/auth/signout")
      .set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
    expect((await agent.get("/api/me")).status).toBe(200);
  });
});
