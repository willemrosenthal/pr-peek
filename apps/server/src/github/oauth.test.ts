import { describe, expect, it, vi } from "vitest";
import { createGitHubOAuth, GitHubAuthError, parseTokenExpiry } from "./oauth";

const NOW = new Date("2026-10-21T12:00:00Z");
const REDIRECT = "https://git-buddy.example/api/auth/github/callback";

function setup(
  response: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(Response.json(response, { status, headers })),
  );
  const oauth = createGitHubOAuth({
    clientId: "client-id",
    clientSecret: "client-secret",
    fetch,
    now: () => NOW,
  });
  const sentBody = () =>
    JSON.parse(fetch.mock.calls[0]?.[1]?.body as string) as Record<
      string,
      string
    >;
  return { oauth, fetch, sentBody };
}

describe("authorizeUrl", () => {
  it("asks for full access by default", () => {
    const { oauth } = setup({});
    const url = new URL(
      oauth.authorizeUrl({
        state: "abc",
        scope: "full",
        redirectUri: REDIRECT,
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-id",
      redirect_uri: REDIRECT,
      scope: "repo read:org notifications",
      state: "abc",
    });
  });

  it("asks for public repos only when chosen", () => {
    const { oauth } = setup({});
    const url = new URL(
      oauth.authorizeUrl({
        state: "abc",
        scope: "public",
        redirectUri: REDIRECT,
      }),
    );
    expect(url.searchParams.get("scope")).toBe(
      "public_repo read:org notifications",
    );
  });
});

describe("exchangeCode", () => {
  it("returns tokens with expiry times", async () => {
    const { oauth, sentBody } = setup({
      access_token: "ghu_access",
      expires_in: 28800,
      refresh_token: "ghr_refresh",
      refresh_token_expires_in: 15897600,
      scope: "repo,read:org",
    });

    expect(await oauth.exchangeCode("the-code", REDIRECT)).toEqual({
      accessToken: "ghu_access",
      accessTokenExpiresAt: new Date("2026-10-21T20:00:00Z"),
      refreshToken: "ghr_refresh",
      refreshTokenExpiresAt: new Date("2027-04-23T12:00:00Z"),
      scopes: ["repo", "read:org"],
    });
    expect(sentBody()).toEqual({
      client_id: "client-id",
      client_secret: "client-secret",
      code: "the-code",
      redirect_uri: REDIRECT,
    });
  });

  it("handles tokens that never expire", async () => {
    const { oauth } = setup({ access_token: "gho_access", scope: "" });
    expect(await oauth.exchangeCode("the-code", REDIRECT)).toMatchObject({
      accessTokenExpiresAt: null,
      refreshToken: null,
      scopes: [],
    });
  });

  it("throws GitHubAuthError for a bad code", async () => {
    const { oauth } = setup({
      error: "bad_verification_code",
      error_description: "The code passed is incorrect or expired.",
    });
    await expect(oauth.exchangeCode("old", REDIRECT)).rejects.toMatchObject({
      name: "GitHubAuthError",
      code: "bad_verification_code",
    });
  });

  it("throws a plain error when GitHub is down", async () => {
    const { oauth } = setup({}, 502);
    const error = await oauth
      .exchangeCode("x", REDIRECT)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GitHubAuthError);
  });
});

describe("refresh", () => {
  it("sends the refresh token", async () => {
    const { oauth, sentBody } = setup({
      access_token: "ghu_new",
      expires_in: 28800,
    });
    await oauth.refresh("ghr_old");
    expect(sentBody()).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "ghr_old",
    });
  });
});

describe("revokeGrant", () => {
  it("asks GitHub to delete the grant, signed with the app's client secret", async () => {
    const { oauth, fetch, sentBody } = setup(null);
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await oauth.revokeGrant("ghu_access");

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.github.com/applications/client-id/grant");
    expect(init?.method).toBe("DELETE");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
    );
    expect(sentBody()).toEqual({ access_token: "ghu_access" });
  });

  it.each([404, 422])(
    "counts %i as done: the grant is gone already",
    async (status) => {
      const { oauth } = setup({ message: "Not Found" }, status);
      await expect(oauth.revokeGrant("ghu_access")).resolves.toBeUndefined();
    },
  );

  it("throws when GitHub fails", async () => {
    const { oauth } = setup({ message: "Server Error" }, 500);
    await expect(oauth.revokeGrant("ghu_access")).rejects.toThrow("500");
  });
});

describe("getUser", () => {
  it("returns the GitHub profile", async () => {
    const { oauth, fetch } = setup({
      id: 42,
      login: "octocat",
      name: "The Octocat",
      avatar_url: "https://avatars.example/42",
    });
    expect(await oauth.getUser("ghu_access")).toEqual({
      id: 42,
      login: "octocat",
      name: "The Octocat",
      avatarUrl: "https://avatars.example/42",
    });
    const headers = fetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghu_access");
  });
});

describe("checkToken", () => {
  const profile = {
    id: 42,
    login: "octocat",
    name: null,
    avatar_url: "https://avatars.example/42",
  };

  it("returns the user, scopes, and expiry of a classic token", async () => {
    const { oauth, fetch } = setup(profile, 200, {
      "x-oauth-scopes": "repo, read:org",
      "github-authentication-token-expiration": "2026-10-28 18:00:00 UTC",
    });
    expect(await oauth.checkToken("ghp_token")).toEqual({
      user: {
        id: 42,
        login: "octocat",
        name: null,
        avatarUrl: "https://avatars.example/42",
      },
      scopes: ["repo", "read:org"],
      expiresAt: new Date("2026-10-28T18:00:00Z"),
    });
    const headers = fetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_token");
  });

  it("reports an empty scope list as no scopes", async () => {
    const { oauth } = setup(profile, 200, { "x-oauth-scopes": "" });
    expect(await oauth.checkToken("ghp_token")).toMatchObject({
      scopes: [],
      expiresAt: null,
    });
  });

  it("returns null scopes for a fine-grained token", async () => {
    const { oauth } = setup(profile);
    expect(await oauth.checkToken("github_pat_token")).toMatchObject({
      scopes: null,
    });
  });

  it("throws GitHubAuthError for a bad token", async () => {
    const { oauth } = setup({ message: "Bad credentials" }, 401);
    await expect(oauth.checkToken("ghp_bad")).rejects.toMatchObject({
      name: "GitHubAuthError",
      code: "bad_token",
    });
  });

  it("throws a plain error when GitHub is down", async () => {
    const { oauth } = setup({}, 502);
    const error = await oauth.checkToken("ghp_token").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GitHubAuthError);
  });
});

describe("parseTokenExpiry", () => {
  it("reads GitHub's UTC format", () => {
    expect(parseTokenExpiry("2026-10-28 18:00:00 UTC")).toEqual(
      new Date("2026-10-28T18:00:00Z"),
    );
  });

  it("reads a numeric time zone", () => {
    expect(parseTokenExpiry("2026-10-28 11:00:00 -0700")).toEqual(
      new Date("2026-10-28T18:00:00Z"),
    );
  });

  it("returns null for a missing or unknown value", () => {
    expect(parseTokenExpiry(null)).toBeNull();
    expect(parseTokenExpiry("next tuesday")).toBeNull();
  });
});
