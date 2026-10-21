// Talks to GitHub's OAuth endpoints: the sign in link, swapping a code for tokens, and refreshing them.

export type ScopeChoice = "full" | "public";

const SCOPES: Record<ScopeChoice, string> = {
  // `repo` is needed to read private repos. GitHub has no read-only version for OAuth Apps.
  full: "repo read:org notifications",
  public: "public_repo read:org notifications",
};

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

export interface GitHubOAuth {
  authorizeUrl(options: {
    state: string;
    scope: ScopeChoice;
    redirectUri: string;
  }): string;
  exchangeCode(code: string, redirectUri: string): Promise<GitHubTokens>;
  refresh(refreshToken: string): Promise<GitHubTokens>;
  getUser(accessToken: string): Promise<GitHubUser>;
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

  return {
    authorizeUrl({ state, scope, redirectUri }) {
      const url = new URL("https://github.com/login/oauth/authorize");
      url.search = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: redirectUri,
        scope: SCOPES[scope],
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
      const res = await request("https://api.github.com/user", {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!res.ok) throw new Error(`GitHub user request failed: ${res.status}`);
      const user = (await res.json()) as UserResponse;
      return {
        id: user.id,
        login: user.login,
        name: user.name,
        avatarUrl: user.avatar_url,
      };
    },
  };
}
