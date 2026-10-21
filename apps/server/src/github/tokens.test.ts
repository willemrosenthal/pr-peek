import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, resetDb } from "../../test/db";
import {
  fakeOAuth,
  githubTokens,
  githubUser,
  hours,
  NOW,
  TEST_KEY,
} from "../../test/fakes";
import { upsertGitHubUser } from "../users";
import { GitHubAuthError } from "./oauth";
import { getAccessToken, NeedsReauthError } from "./tokens";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

async function userWith(tokens = githubTokens()) {
  const { user } = await upsertGitHubUser(db, githubUser(), tokens, TEST_KEY);
  return user;
}

function deps(oauth = fakeOAuth()) {
  return { db, oauth, key: TEST_KEY, now: () => NOW };
}

describe("getAccessToken", () => {
  it("returns the stored token while it's fresh", async () => {
    const user = await userWith();
    const oauth = fakeOAuth();
    expect(await getAccessToken(deps(oauth), user.id)).toBe("ghu_access");
    expect(oauth.refresh).not.toHaveBeenCalled();
  });

  it("returns tokens that never expire", async () => {
    const user = await userWith(githubTokens({ accessTokenExpiresAt: null }));
    expect(await getAccessToken(deps(), user.id)).toBe("ghu_access");
  });

  it("refreshes a token that's about to expire, and saves the new one", async () => {
    const user = await userWith(
      githubTokens({ accessTokenExpiresAt: hours(0.05) }),
    );
    const oauth = fakeOAuth();

    expect(await getAccessToken(deps(oauth), user.id)).toBe("ghu_refreshed");
    expect(oauth.refresh).toHaveBeenCalledWith("ghr_refresh");

    // The next call uses the saved token instead of refreshing again.
    expect(await getAccessToken(deps(oauth), user.id)).toBe("ghu_refreshed");
    expect(oauth.refresh).toHaveBeenCalledTimes(1);
  });

  it("only refreshes once when two calls race", async () => {
    const user = await userWith(
      githubTokens({ accessTokenExpiresAt: hours(-1) }),
    );
    // Slow enough that both calls are in flight at once.
    const oauth = fakeOAuth({
      refresh: () =>
        new Promise((done) =>
          setTimeout(
            () => done(githubTokens({ accessToken: "ghu_refreshed" })),
            50,
          ),
        ),
    });

    const tokens = await Promise.all([
      getAccessToken(deps(oauth), user.id),
      getAccessToken(deps(oauth), user.id),
    ]);

    expect(tokens).toEqual(["ghu_refreshed", "ghu_refreshed"]);
    expect(oauth.refresh).toHaveBeenCalledTimes(1);
  });

  it("asks the user to sign in again when the refresh token has expired", async () => {
    const user = await userWith(
      githubTokens({
        accessTokenExpiresAt: hours(-1),
        refreshTokenExpiresAt: hours(-1),
      }),
    );
    const oauth = fakeOAuth();

    await expect(getAccessToken(deps(oauth), user.id)).rejects.toBeInstanceOf(
      NeedsReauthError,
    );
    expect(oauth.refresh).not.toHaveBeenCalled();
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).syncError,
    ).toBe("reauth");
  });

  it("asks the user to sign in again when GitHub rejects the refresh", async () => {
    const user = await userWith(
      githubTokens({ accessTokenExpiresAt: hours(-1) }),
    );
    const oauth = fakeOAuth({
      refresh: () =>
        Promise.reject(new GitHubAuthError("bad_refresh_token", "nope")),
    });

    await expect(getAccessToken(deps(oauth), user.id)).rejects.toBeInstanceOf(
      NeedsReauthError,
    );
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).syncError,
    ).toBe("reauth");
  });

  it("passes through other errors without marking the user", async () => {
    const user = await userWith(
      githubTokens({ accessTokenExpiresAt: hours(-1) }),
    );
    const oauth = fakeOAuth({
      refresh: () => Promise.reject(new Error("GitHub is down")),
    });

    await expect(getAccessToken(deps(oauth), user.id)).rejects.toThrow(
      "GitHub is down",
    );
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).syncError,
    ).toBeNull();
  });
});
