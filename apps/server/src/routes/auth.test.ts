import type request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { APP_URL, makeTestApp, signIn, startSignIn } from "../../test/app";
import { createTestDb, resetDb } from "../../test/db";
import { fakeOAuth } from "../../test/fakes";
import { GitHubAuthError } from "../github/oauth";

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
      user: { login: "octocat", scopes: ["repo", "read:org", "notifications"] },
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
