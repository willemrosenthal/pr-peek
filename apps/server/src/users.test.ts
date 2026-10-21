import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, resetDb } from "../test/db";
import { githubTokens, githubUser, TEST_KEY } from "../test/fakes";
import { decrypt } from "./crypto";
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

  it("updates the same user on a later sign in and clears the reauth flag", async () => {
    const first = await upsertGitHubUser(
      db,
      githubUser(),
      githubTokens(),
      TEST_KEY,
    );
    await db.user.update({
      where: { id: first.user.id },
      data: { syncError: "reauth" },
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
    });
    expect(decrypt(second.user.accessTokenEnc ?? "", TEST_KEY)).toBe("ghu_new");
    expect(await db.userSettings.count()).toBe(1);
  });
});
