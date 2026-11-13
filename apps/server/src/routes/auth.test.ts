import type { MeResponse, SignUpInfoResponse } from "@pr-peek/core";
import express from "express";
import type request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_URL,
  bodyOf,
  makeTestApp,
  signIn,
  startSignIn,
} from "../../test/app";
import { createTestDb, resetDb } from "../../test/db";
import {
  fakeOAuth,
  githubTokens,
  githubUser,
  NOW,
  TEST_KEY,
} from "../../test/fakes";
import { setApprovesSignUps } from "../app-settings";
import { GitHubAuthError } from "../github/oauth";
import type { SendPush } from "../push";
import { upsertGitHubUser } from "../users";
import { requireUser } from "./auth";

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
      redirectUri: `${APP_URL}/api/auth/github/callback`,
    });
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
        scopes: ["repo", "read:org", "notifications"],
      },
      githubTokens: [],
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

  it("reports a sign in that stopped while a token still works", async () => {
    const { agent } = makeApp();
    await signIn(agent);
    await db.user.updateMany({ data: { signInStoppedAt: new Date() } });

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

describe("sign-up requests", () => {
  // A route behind the usual sign in check.
  const guarded = () => {
    const router = express.Router();
    router.get("/guarded", requireUser(db), (_req, res) => {
      res.sendStatus(204);
    });
    return router;
  };

  it("lets a new user wait, with 403 everywhere but /me", async () => {
    const { agent } = makeTestApp(db, { routers: [guarded()] });
    await signIn(agent, { pending: true });

    expect(bodyOf<MeResponse>(await agent.get("/api/me")).pending).toBe(true);
    const res = await agent.get("/api/guarded");
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "pending" } });
  });

  it("lets an approved user in", async () => {
    const { agent } = makeTestApp(db, { routers: [guarded()] });
    await signIn(agent);

    expect(bodyOf<MeResponse>(await agent.get("/api/me")).pending).toBe(false);
    expect((await agent.get("/api/guarded")).status).toBe(204);
  });

  // An approved admin with one push device.
  async function adminWithPhone() {
    const { user } = await upsertGitHubUser(
      db,
      githubUser({ id: 7, login: "admin" }),
      githubTokens(),
      TEST_KEY,
    );
    await db.user.update({
      where: { id: user.id },
      data: {
        role: "admin",
        approvedAt: NOW,
        pushSubscriptions: {
          create: {
            endpoint: "https://push.example/a",
            p256dh: "k",
            auth: "a",
          },
        },
      },
    });
  }

  it("pushes each new request to the admins, once", async () => {
    const send = vi.fn<SendPush>(() => Promise.resolve());
    await adminWithPhone();
    const { agent } = makeTestApp(db, { send });

    await signIn(agent, { pending: true });
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ endpoint: "https://push.example/a" }),
      expect.objectContaining({
        body: "octocat asked to use Git Buddy.",
        url: "/settings/admin",
      }),
      expect.anything(),
    );

    // Signing in again while waiting isn't a new request.
    await signIn(agent, { pending: true });
    expect(send).toHaveBeenCalledOnce();
  });

  it("lets a new user in right away while approval is off, and tells the admins", async () => {
    const send = vi.fn<SendPush>(() => Promise.resolve());
    await adminWithPhone();
    const { agent } = makeTestApp(db, { send, routers: [guarded()] });

    await signIn(agent);

    expect(bodyOf<MeResponse>(await agent.get("/api/me")).pending).toBe(false);
    expect((await agent.get("/api/guarded")).status).toBe(204);
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({
        title: "New Git Buddy user",
        body: "octocat signed up for Git Buddy.",
      }),
      expect.anything(),
    );
  });

  it("keeps letting in approved users after approval is turned on", async () => {
    const { agent } = makeTestApp(db, { routers: [guarded()] });
    await signIn(agent);
    await setApprovesSignUps(db, true);

    await signIn(agent);
    expect((await agent.get("/api/guarded")).status).toBe(204);
  });

  it("tells the sign-in page whether new users wait", async () => {
    const { agent } = makeTestApp(db);
    const approval = async () =>
      bodyOf<SignUpInfoResponse>(await agent.get("/api/auth/sign-up")).approval;

    expect(await approval()).toBe(false);
    await setApprovesSignUps(db, true);
    expect(await approval()).toBe(true);
  });
});

describe("DELETE /api/me", () => {
  it("withdraws a waiting request: deletes the user and signs out", async () => {
    const { agent } = makeApp();
    await signIn(agent, { pending: true });

    const res = await agent.delete("/api/me").set("Origin", APP_URL);
    expect(res.status).toBe(204);
    expect(await db.user.count()).toBe(0);
    expect((await agent.get("/api/me")).status).toBe(401);
  });

  it("deletes an account: takes back the GitHub grant, and signs out everywhere", async () => {
    const { agent, oauth } = makeApp();
    await signIn(agent);
    const user = await db.user.findFirstOrThrow();
    // Sessions saved like connect-pg-simple saves them: this user's other device, and
    // someone else's.
    const expire = new Date(Date.now() + 60 * 60 * 1000);
    await db.session.createMany({
      data: [
        { sid: "other-device", sess: { userId: user.id }, expire },
        { sid: "someone-else", sess: { userId: "someone-else" }, expire },
      ],
    });

    const res = await agent.delete("/api/me").set("Origin", APP_URL);
    expect(res.status).toBe(204);
    // With a fresh token: the stored one had expired, so it was refreshed first.
    expect(oauth.revokeGrant).toHaveBeenCalledExactlyOnceWith("ghu_refreshed");
    expect(await db.user.count()).toBe(0);
    expect((await db.session.findMany()).map((s) => s.sid)).toEqual([
      "someone-else",
    ]);
    expect((await agent.get("/api/me")).status).toBe(401);
  });

  it("still deletes the account when GitHub won't take back the grant", async () => {
    const { agent } = makeApp(
      fakeOAuth({
        revokeGrant: () => Promise.reject(new Error("GitHub down")),
      }),
    );
    await signIn(agent);

    expect((await agent.delete("/api/me").set("Origin", APP_URL)).status).toBe(
      204,
    );
    expect(await db.user.count()).toBe(0);
  });
});
