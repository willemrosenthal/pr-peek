// Talks to GitHub's OAuth endpoints: the sign in link, swapping a code for tokens, and refreshing them.
// Also checks personal access tokens that users paste in.

import { Octokit } from "octokit";
import { listTokenOwners } from "./repos";

// Read-only on purpose (plan 22). Any token reads public repos, and `read:org` finds the
// user's teams. Private repos need `repo`, which can also write, so they come only through
// fine-grained tokens the user adds.
const SIGN_IN_SCOPE = "read:org";

export interface GitHubTokens {
  accessToken: string;
  // Null when the OAuth App doesn't expire tokens.
  accessTokenExpiresAt: Date | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
  scopes: string[];
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
}

// What GitHub says about a pasted personal access token.
export interface CheckedToken {
  user: GitHubUser;
  // Null for fine-grained tokens, which have no scopes.
  scopes: string[] | null;
  // Null when the token never expires.
  expiresAt: Date | null;
}

export interface GitHubOAuth {
  authorizeUrl(options: { state: string; redirectUri: string }): string;
  exchangeCode(code: string, redirectUri: string): Promise<GitHubTokens>;
  refresh(refreshToken: string): Promise<GitHubTokens>;
  getUser(accessToken: string): Promise<GitHubUser>;
  checkToken(token: string): Promise<CheckedToken>;
  // The owners of a personal access token's private repos (see listTokenOwners).
  tokenOwners(token: string): Promise<string[]>;
  // Takes back the user's grant of Git Buddy on GitHub, so it can't act for them.
  revokeGrant(accessToken: string): Promise<void>;
}

// GitHub said no: a bad or expired code or refresh token. The user has to sign in again.
export class GitHubAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GitHubAuthError";
  }
}

interface Options {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface UserResponse {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

const toGitHubUser = (user: UserResponse): GitHubUser => ({
  id: user.id,
  login: user.login,
  name: user.name,
  avatarUrl: user.avatar_url,
});

// GitHub sends token expiry like "2026-10-28 18:00:00 UTC", which Date can't parse reliably.
export function parseTokenExpiry(header: string | null): Date | null {
  const match = header?.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{2}:?\d{2})$/,
  );
  if (!match) return null;
  const [, date, time, zone = "UTC"] = match;
  const offset =
    zone === "UTC" ? "Z" : zone.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = new Date(`${date}T${time}${offset}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function createGitHubOAuth(options: Options): GitHubOAuth {
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  const inSeconds = (seconds: number | undefined) =>
    seconds === undefined ? null : new Date(now().getTime() + seconds * 1000);

  async function requestTokens(
    params: Record<string, string>,
  ): Promise<GitHubTokens> {
    const res = await request("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        ...params,
      }),
    });
    if (!res.ok) throw new Error(`GitHub token request failed: ${res.status}`);

    // GitHub reports problems like a bad code as a 200 with an `error` field.
    const body = (await res.json()) as TokenResponse;
    if (body.error || !body.access_token) {
      throw new GitHubAuthError(
        body.error ?? "no_access_token",
        body.error_description ?? "GitHub returned no access token",
      );
    }

    return {
      accessToken: body.access_token,
      accessTokenExpiresAt: inSeconds(body.expires_in),
      refreshToken: body.refresh_token ?? null,
      refreshTokenExpiresAt: inSeconds(body.refresh_token_expires_in),
      scopes: body.scope ? body.scope.split(",").filter(Boolean) : [],
    };
  }

  const fetchUser = (accessToken: string) =>
    request("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
      },
    });

  return {
    authorizeUrl({ state, redirectUri }) {
      const url = new URL("https://github.com/login/oauth/authorize");
      url.search = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: redirectUri,
        scope: SIGN_IN_SCOPE,
        state,
      }).toString();
      return url.toString();
    },

    exchangeCode(code, redirectUri) {
      return requestTokens({ code, redirect_uri: redirectUri });
    },

    refresh(refreshToken) {
      return requestTokens({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
    },

    async getUser(accessToken) {
      const res = await fetchUser(accessToken);
      if (!res.ok) throw new Error(`GitHub user request failed: ${res.status}`);
      return toGitHubUser((await res.json()) as UserResponse);
    },

    async revokeGrant(accessToken) {
      const basic = Buffer.from(
        `${options.clientId}:${options.clientSecret}`,
      ).toString("base64");
      const res = await request(
        `https://api.github.com/applications/${options.clientId}/grant`,
        {
          method: "DELETE",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: accessToken }),
        },
      );
      // 404: the grant is gone already. Anything else, like 422 (GitHub turned the
      // request down, or limited it), leaves it in place.
      if (!res.ok && res.status !== 404) {
        throw new Error(`GitHub grant revoke failed: ${res.status}`);
      }
    },

    async tokenOwners(token) {
      const octokit = new Octokit({
        auth: token,
        request: { fetch: request },
        throttle: { enabled: false },
      });
      return listTokenOwners(octokit);
    },

    async checkToken(token) {
      const res = await fetchUser(token);
      if (res.status === 401) {
        throw new GitHubAuthError(
          "bad_token",
          "GitHub didn't accept the token",
        );
      }
      if (!res.ok) throw new Error(`GitHub user request failed: ${res.status}`);

      // Only classic tokens send this header.
      const scopeHeader = res.headers.get("x-oauth-scopes");
      return {
        user: toGitHubUser((await res.json()) as UserResponse),
        scopes:
          scopeHeader === null
            ? null
            : scopeHeader
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
        expiresAt: parseTokenExpiry(
          res.headers.get("github-authentication-token-expiration"),
        ),
      };
    },
  };
}
