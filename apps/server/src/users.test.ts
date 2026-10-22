import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, resetDb } from "../test/db";
import { githubTokens, githubUser, TEST_KEY } from "../test/fakes";
import { decrypt } from "./crypto";
import { encryptPersonalToken } from "./github/tokens";
import { upsertGitHubUser } from "./users";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

describe("upsertGitHubUser", () => {
  it("creates a new user with default settings", async () => {
    const { user, isNew } = await upsertGitHubUser(
      db,
      githubUser(),
      githubTokens(),
      TEST_KEY,
    );

    expect(isNew).toBe(true);
    expect(user).toMatchObject({
      githubId: 42,
      login: "octocat",
      syncError: null,
    });
    const settings = await db.userSettings.findUnique({
      where: { userId: user.id },
    });
    expect(settings).toMatchObject({ timezone: "UTC", staleWarnHours: 4 });

    const ruleSettings = await db.ruleSetting.findMany({
      where: { userId: user.id },
    });
    expect(ruleSettings.map((s) => s.ruleId).sort()).toEqual([
      "check_failed",
      "commented",
      "re_requested",
      "reply",
      "review_requested",
      "reviewed",
    ]);
    expect(ruleSettings.find((s) => s.ruleId === "check_failed")).toMatchObject(
      {
        enabled: true,
        severity: "high",
        channels: ["list", "push"],
      },
    );
  });

  it("stores tokens encrypted, never as plain text", async () => {
    const { user } = await upsertGitHubUser(
      db,
      githubUser(),
      githubTokens(),
      TEST_KEY,
    );

    expect(user.accessTokenEnc).not.toContain("ghu_access");
    expect(user.refreshTokenEnc).not.toContain("ghr_refresh");
    expect(decrypt(user.accessTokenEnc ?? "", TEST_KEY)).toBe("ghu_access");
    expect(user.tokenScopes).toEqual(["repo", "read:org", "notifications"]);
  });

  it("updates the same user on a later sign in and clears sync errors", async () => {
    const first = await upsertGitHubUser(
      db,
      githubUser(),
      githubTokens(),
      TEST_KEY,
    );
    await db.user.update({
      where: { id: first.user.id },
      data: { syncError: "reauth", syncFailures: 3, syncRetryAt: new Date() },
    });

    const second = await upsertGitHubUser(
      db,
      githubUser({ login: "octocat-renamed" }),
      githubTokens({ accessToken: "ghu_new" }),
      TEST_KEY,
    );

    expect(second.isNew).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    expect(second.user).toMatchObject({
      login: "octocat-renamed",
      syncError: null,
      syncFailures: 0,
      syncRetryAt: null,
    });
    expect(decrypt(second.user.accessTokenEnc ?? "", TEST_KEY)).toBe("ghu_new");
    expect(await db.userSettings.count()).toBe(1);
  });

  it("keeps the personal access token, and its error, on a later sign in", async () => {
    const first = await upsertGitHubUser(
      db,
      githubUser(),
      githubTokens(),
      TEST_KEY,
    );
    await db.user.update({
      where: { id: first.user.id },
      data: {
        ...encryptPersonalToken(
          { token: "ghp_token", expiresAt: null, scopes: ["repo"] },
          TEST_KEY,
        ),
        syncError: "token",
      },
    });

    const { user } = await upsertGitHubUser(
      db,
      githubUser(),
      githubTokens(),
      TEST_KEY,
    );
    expect(decrypt(user.patEnc ?? "", TEST_KEY)).toBe("ghp_token");
    // The token is still broken, so syncs wait for a new one.
    expect(user.syncError).toBe("token");
  });
});
