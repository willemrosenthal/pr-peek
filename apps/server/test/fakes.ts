import { randomBytes } from "node:crypto";
import { vi } from "vitest";
import { KEY_BYTES } from "../src/crypto";
import type {
  GitHubOAuth,
  GitHubTokens,
  GitHubUser,
} from "../src/github/oauth";

export const TEST_KEY = randomBytes(KEY_BYTES);

export const NOW = new Date("2026-10-21T12:00:00Z");
// A time `n` hours after NOW (negative for before).
export const hours = (n: number) =>
  new Date(NOW.getTime() + n * 60 * 60 * 1000);
export const minutes = (n: number) => hours(n / 60);

export function githubUser(overrides: Partial<GitHubUser> = {}): GitHubUser {
  return {
    id: 42,
    login: "octocat",
    name: "The Octocat",
    avatarUrl: "https://avatars.example/42",
    ...overrides,
  };
}

export function githubTokens(
  overrides: Partial<GitHubTokens> = {},
): GitHubTokens {
  return {
    accessToken: "ghu_access",
    accessTokenExpiresAt: hours(8),
    refreshToken: "ghr_refresh",
    refreshTokenExpiresAt: hours(24 * 180),
    scopes: ["repo", "read:org", "notifications"],
    ...overrides,
  };
}

// A stand-in for GitHub's OAuth endpoints. Every method is a spy; override any per test.
export function fakeOAuth(overrides: Partial<GitHubOAuth> = {}) {
  return {
    authorizeUrl: vi.fn<GitHubOAuth["authorizeUrl"]>(
      overrides.authorizeUrl ??
        (({ state }) =>
          `https://github.com/login/oauth/authorize?state=${state}`),
    ),
    exchangeCode: vi.fn<GitHubOAuth["exchangeCode"]>(
      overrides.exchangeCode ?? (() => Promise.resolve(githubTokens())),
    ),
    refresh: vi.fn<GitHubOAuth["refresh"]>(
      overrides.refresh ??
        (() => Promise.resolve(githubTokens({ accessToken: "ghu_refreshed" }))),
    ),
    getUser: vi.fn<GitHubOAuth["getUser"]>(
      overrides.getUser ?? (() => Promise.resolve(githubUser())),
    ),
    checkToken: vi.fn<GitHubOAuth["checkToken"]>(
      overrides.checkToken ??
        (() =>
          Promise.resolve({
            user: githubUser(),
            scopes: ["repo", "read:org"],
            expiresAt: hours(24 * 30),
          })),
    ),
    tokenOwners: vi.fn<GitHubOAuth["tokenOwners"]>(
      overrides.tokenOwners ?? (() => Promise.resolve(["acme"])),
    ),
  };
}
