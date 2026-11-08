import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addPersonalToken,
  addToken,
  createTestDb,
  resetDb,
} from "../../test/db";
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
  markRejected,
  NeedsReauthError,
  pickToken,
  reencryptTokens,
} from "./tokens";

const db = createTestDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const reload = (id: string) => db.user.findUniqueOrThrow({ where: { id } });

async function userWith(tokens = githubTokens()) {
  const { user } = await upsertGitHubUser(db, githubUser(), tokens, TEST_KEY);
  return user;
}

function deps(oauth = fakeOAuth()) {
  return { db, oauth, key: TEST_KEY, now: () => NOW };
}

describe("pickToken", () => {
  const token = (
    id: string,
    extra: Partial<Parameters<typeof pickToken>[0][number]> = {},
  ) => ({
    id,
    kind: "fine_grained" as const,
    owners: [],
    status: "working" as const,
    createdAt: hours(-1),
    ...extra,
  });

  it("picks the token that reaches the owner, ignoring case", () => {
    const tokens = [
      token("acme", { owners: ["Acme"] }),
      token("globex", { owners: ["globex"] }),
    ];
    expect(pickToken(tokens, "acme")).toBe("acme");
    expect(pickToken(tokens, "GLOBEX")).toBe("globex");
  });

  it("uses the sign in when no working token reaches the owner", () => {
    const tokens = [
      token("acme", { owners: ["acme"], status: "stopped" }),
      token("globex", { owners: ["globex"] }),
    ];
    expect(pickToken(tokens, "acme")).toBeNull();
    expect(pickToken([], "acme")).toBeNull();
  });

  it("counts a classic token as reaching every owner, and prefers the newest", () => {
    const tokens = [
      token("old", { kind: "classic", createdAt: hours(-2) }),
      token("new", { owners: ["acme"], createdAt: hours(-1) }),
    ];
    expect(pickToken(tokens, "acme")).toBe("new");
    expect(pickToken(tokens, "initech")).toBe("old");
  });
});

describe("getAccessToken", () => {
  it("returns the stored token while it's fresh", async () => {
    const user = await userWith();
    const oauth = fakeOAuth();
    expect((await getAccessToken(deps(oauth), user.id)).token).toBe(
      "ghu_access",
    );
    expect(oauth.refresh).not.toHaveBeenCalled();
  });

  it("returns tokens that never expire", async () => {
    const user = await userWith(githubTokens({ accessTokenExpiresAt: null }));
    expect((await getAccessToken(deps(), user.id)).token).toBe("ghu_access");
  });

  it("refreshes a token that's about to expire, and saves the new one", async () => {
    const user = await userWith(
      githubTokens({ accessTokenExpiresAt: hours(0.05) }),
    );
    const oauth = fakeOAuth();

    expect((await getAccessToken(deps(oauth), user.id)).token).toBe(
      "ghu_refreshed",
    );
    expect(oauth.refresh).toHaveBeenCalledWith("ghr_refresh");

    // The next call uses the saved token instead of refreshing again.
    expect((await getAccessToken(deps(oauth), user.id)).token).toBe(
      "ghu_refreshed",
    );
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

    expect(tokens.map((t) => t.token)).toEqual([
      "ghu_refreshed",
      "ghu_refreshed",
    ]);
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
      await addPersonalToken(db, user.id, "ghp_token", expiresAt);
      return user;
    }

    it("uses it instead of the sign in token", async () => {
      const user = await userWithPat(null);
      const oauth = fakeOAuth();
      expect((await getAccessToken(deps(oauth), user.id)).token).toBe(
        "ghp_token",
      );
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
      const token = await db.gitHubToken.findFirstOrThrow();
      expect(token.status).toBe("stopped");
      expect(token.stoppedAt).toBeInstanceOf(Date);
    });

    it("fills in the hash and kind of a token copied from the User row", async () => {
      const user = await userWith(
        githubTokens({ accessTokenExpiresAt: hours(-1) }),
      );
      const fields = encryptPersonalToken(
        { token: "ghp_token", expiresAt: null, scopes: ["repo"] },
        TEST_KEY,
      );
      // As the migration copies it: no hash or kind yet.
      await db.gitHubToken.create({
        data: {
          ...fields,
          tokenHash: null,
          kind: null,
          userId: user.id,
          name: "Personal access token",
        },
      });

      expect((await getAccessToken(deps(), user.id)).token).toBe("ghp_token");
      expect(await db.gitHubToken.findFirstOrThrow()).toMatchObject({
        tokenHash: fields.tokenHash,
        kind: "classic",
      });
    });
  });

  describe("choosing a token", () => {
    it("by default, skips a stopped token for a working one", async () => {
      const user = await userWith();
      const older = await addToken(db, user.id, "github_pat_older", {
        createdAt: hours(-2),
      });
      await addToken(db, user.id, "github_pat_newer", { status: "stopped" });

      expect(await getAccessToken(deps(), user.id)).toEqual({
        token: "github_pat_older",
        tokenId: older.id,
      });
    });

    it("uses the token that reaches the owner, else the sign in", async () => {
      const user = await userWith();
      const acme = await addToken(db, user.id, "github_pat_acme", {
        owners: ["acme"],
      });

      expect(await getAccessToken(deps(), user.id, { owner: "acme" })).toEqual({
        token: "github_pat_acme",
        tokenId: acme.id,
      });
      expect(
        await getAccessToken(deps(), user.id, { owner: "globex" }),
      ).toEqual({ token: "ghu_access", tokenId: null });
    });

    it("uses the token asked for, or the sign in for null", async () => {
      const user = await userWith();
      const acme = await addToken(db, user.id, "github_pat_acme");

      expect(
        await getAccessToken(deps(), user.id, { tokenId: acme.id }),
      ).toEqual({ token: "github_pat_acme", tokenId: acme.id });
      expect(await getAccessToken(deps(), user.id, { tokenId: null })).toEqual({
        token: "ghu_access",
        tokenId: null,
      });
    });
  });

  describe("markRejected", () => {
    it("asks to sign in again when the user has no personal access token", async () => {
      const user = await userWith();
      expect(await markRejected(db, user.id, null)).toBe("reauth");
      expect((await reload(user.id)).syncError).toBe("reauth");
    });

    it("asks for a new token when the last working one stops", async () => {
      const user = await userWith();
      const token = await addPersonalToken(db, user.id);
      expect(await markRejected(db, user.id, token.id)).toBe("token");
      expect((await db.gitHubToken.findFirstOrThrow()).status).toBe("stopped");
      expect((await reload(user.id)).syncError).toBe("token");
    });

    it("stops only that token while another still works", async () => {
      const user = await userWith();
      const first = await addToken(db, user.id, "github_pat_first");
      const second = await addToken(db, user.id, "github_pat_second");
      expect(await markRejected(db, user.id, first.id)).toBeNull();
      expect(
        await db.gitHubToken.findUniqueOrThrow({ where: { id: second.id } }),
      ).toMatchObject({ status: "working" });
      expect((await reload(user.id)).syncError).toBeNull();
    });

    it("leaves syncs alone when the sign in fails but a token works", async () => {
      const user = await userWith();
      await addPersonalToken(db, user.id);
      expect(await markRejected(db, user.id, null)).toBeNull();
      expect(await reload(user.id)).toMatchObject({
        syncError: null,
        // Remembered, so syncs skip the sign in until the user signs in again.
        signInStoppedAt: expect.any(Date) as Date,
      });
    });

    it("leaves the sign in alone when it's not known which token was rejected", async () => {
      const user = await userWith();
      await addPersonalToken(db, user.id);
      await markRejected(db, user.id, undefined);
      expect((await reload(user.id)).signInStoppedAt).toBeNull();
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
    const { token } = await getAccessToken(
      { ...deps(), key: NEW_KEY, previousKey: TEST_KEY },
      user.id,
    );
    expect(token).toBe("ghu_access");
  });

  it("encrypts every token again with the new key", async () => {
    const user = await userWith();
    // No tokens, so not counted.
    const { user: other } = await upsertGitHubUser(
      db,
      githubUser({ id: 7, login: "other" }),
      githubTokens(),
      TEST_KEY,
    );
    await db.user.update({
      where: { id: other.id },
      data: { accessTokenEnc: null, refreshTokenEnc: null },
    });
    await addPersonalToken(db, user.id, "ghp_personal");

    expect(
      await reencryptTokens(db, { key: NEW_KEY, previousKey: TEST_KEY }),
    ).toBe(1);
    const saved = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    // The new key alone reads them now.
    expect(decrypt(saved.accessTokenEnc!, NEW_KEY)).toBe("ghu_access");
    expect(decrypt(saved.refreshTokenEnc!, NEW_KEY)).toBe("ghr_refresh");
    const token = await db.gitHubToken.findFirstOrThrow();
    expect(decrypt(token.tokenEnc, NEW_KEY)).toBe("ghp_personal");
  });
});
