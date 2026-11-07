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
import { randomBytes } from "node:crypto";
import { decrypt, KEY_BYTES } from "../crypto";
import { upsertGitHubUser } from "../users";
import { GitHubAuthError } from "./oauth";
import {
  encryptPersonalToken,
  getAccessToken,
  NeedsReauthError,
  reencryptTokens,
} from "./tokens";

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

  describe("with a personal access token", () => {
    // A user whose sign in token has expired, plus a personal access token.
    async function userWithPat(expiresAt: Date | null) {
      const user = await userWith(
        githubTokens({ accessTokenExpiresAt: hours(-1) }),
      );
      await db.user.update({
        where: { id: user.id },
        data: encryptPersonalToken(
          { token: "ghp_token", expiresAt, scopes: ["repo"] },
          TEST_KEY,
        ),
      });
      return user;
    }

    it("uses it instead of the sign in token", async () => {
      const user = await userWithPat(null);
      const oauth = fakeOAuth();
      expect(await getAccessToken(deps(oauth), user.id)).toBe("ghp_token");
      expect(oauth.refresh).not.toHaveBeenCalled();
    });

    it("asks for a new one when it's about to expire, without falling back", async () => {
      const user = await userWithPat(hours(0.05));
      const oauth = fakeOAuth();

      await expect(getAccessToken(deps(oauth), user.id)).rejects.toMatchObject({
        reason: "token",
        code: "token_invalid",
      });
      expect(oauth.refresh).not.toHaveBeenCalled();
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: user.id } })).syncError,
      ).toBe("token");
    });
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

describe("changing the encryption key", () => {
  const NEW_KEY = randomBytes(KEY_BYTES);

  it("reads tokens saved with the previous key", async () => {
    // Saved before the change, with TEST_KEY.
    const user = await userWith();
    expect(
      await getAccessToken(
        { ...deps(), key: NEW_KEY, previousKey: TEST_KEY },
        user.id,
      ),
    ).toBe("ghu_access");
  });

  it("encrypts every token again with the new key", async () => {
    const user = await userWith();
    await db.user.update({
      where: { id: user.id },
      data: encryptPersonalToken(
        { token: "ghp_personal", expiresAt: null, scopes: ["repo"] },
        TEST_KEY,
      ),
    });

    expect(
      await reencryptTokens(db, { key: NEW_KEY, previousKey: TEST_KEY }),
    ).toBe(1);
    const saved = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    // The new key alone reads them now.
    expect(decrypt(saved.accessTokenEnc!, NEW_KEY)).toBe("ghu_access");
    expect(decrypt(saved.refreshTokenEnc!, NEW_KEY)).toBe("ghr_refresh");
    expect(decrypt(saved.patEnc!, NEW_KEY)).toBe("ghp_personal");
  });
});
