import type { MeResponse } from "@pr-peek/core";
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

const putToken = (agent: Agent, token = "ghp_token") =>
  agent.put("/api/github-token").set("Origin", APP_URL).send({ token });
const deleteToken = (agent: Agent) =>
  agent.delete("/api/github-token").set("Origin", APP_URL);
const user = () => db.user.findFirstOrThrow();

it("needs sign in", async () => {
  const { agent, oauth } = makeApp();
  expect((await putToken(agent)).status).toBe(401);
  expect((await deleteToken(agent)).status).toBe(401);
  expect(oauth.checkToken).not.toHaveBeenCalled();
});

describe("PUT /api/github-token", () => {
  it("adds the token, encrypted, next to the GitHub sign in", async () => {
    const { agent, oauth } = await setup();
    const res = await putToken(agent, "  ghp_token  ");

    expect(res.status).toBe(200);
    const githubToken = {
      expiresAt: hours(24 * 30).toISOString(),
      scopes: ["repo", "read:org"],
      invalid: false,
    };
    expect(res.body).toEqual({ githubToken });
    expect(oauth.checkToken).toHaveBeenCalledWith("ghp_token");

    const saved = await user();
    expect(saved.patEnc).not.toContain("ghp_token");
    expect(decrypt(saved.patEnc ?? "", TEST_KEY)).toBe("ghp_token");
    // The sign in token stays.
    expect(decrypt(saved.accessTokenEnc ?? "", TEST_KEY)).toBe("ghu_access");
    const me = bodyOf<MeResponse>(await agent.get("/api/me"));
    expect(me.githubToken).toEqual(githubToken);
  });

  it("restarts syncs that were stopped", async () => {
    const { agent } = await setup();
    await db.user.updateMany({
      data: { syncError: "token", syncFailures: 2, syncRetryAt: hours(1) },
    });
    await putToken(agent);
    expect(await user()).toMatchObject({
      syncError: null,
      syncFailures: 0,
      syncRetryAt: null,
    });
  });

  it("rejects a token from another GitHub account", async () => {
    const { agent } = await setup(
      tokenIs({ user: githubUser({ id: 99, login: "someone-else" }) }),
    );
    const res = await putToken(agent);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "wrong_account" } });
    expect((await user()).patEnc).toBeNull();
  });

  it("rejects a token GitHub doesn't accept", async () => {
    const { agent } = await setup(() =>
      Promise.reject(new GitHubAuthError("bad_token", "Bad credentials")),
    );
    const res = await putToken(agent);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "bad_token" } });
  });

  it.each([
    [["repo"], 200],
    [["public_repo"], 200],
    // Fine-grained tokens have no scopes.
    [null, 200],
    [["read:org"], 400],
  ])("with scopes %o answers %i", async (scopes, status) => {
    const { agent } = await setup(tokenIs({ scopes }));
    expect((await putToken(agent)).status).toBe(status);
  });

  it("rejects input that isn't a token, without asking GitHub", async () => {
    const { agent, oauth } = await setup();
    for (const token of ["", "has spaces in it", "x".repeat(256)]) {
      const res = await putToken(agent, token);
      expect(res.body).toMatchObject({ error: { code: "invalid_input" } });
    }
    expect(oauth.checkToken).not.toHaveBeenCalled();
  });

  it("is blocked from other sites", async () => {
    const { agent, oauth } = await setup();
    const res = await agent
      .put("/api/github-token")
      .set("Origin", "https://evil.example")
      .send({ token: "ghp_token" });
    expect(res.status).toBe(403);
    expect(oauth.checkToken).not.toHaveBeenCalled();
  });

  it("slows down too many attempts", async () => {
    const { agent } = await setup();
    for (let i = 0; i < 30; i++) await putToken(agent);
    expect((await putToken(agent)).status).toBe(429);
  });
});

describe("DELETE /api/github-token", () => {
  it("removes the token and its error", async () => {
    const { agent } = await setup();
    await putToken(agent);
    await db.user.updateMany({ data: { syncError: "token" } });

    expect((await deleteToken(agent)).status).toBe(204);
    expect(await user()).toMatchObject({
      patEnc: null,
      patExpiresAt: null,
      syncError: null,
    });
    const me = bodyOf<MeResponse>(await agent.get("/api/me"));
    expect(me.githubToken).toBeNull();
  });

  it("keeps other sync errors", async () => {
    const { agent } = await setup();
    await putToken(agent);
    await db.user.updateMany({ data: { syncError: "failed" } });
    await deleteToken(agent);
    expect((await user()).syncError).toBe("failed");
  });
});
