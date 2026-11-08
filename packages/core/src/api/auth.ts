import { z } from "zod";
import type { TokenDto } from "./tokens";

// A GitHub personal access token, classic (`ghp_...`) or fine-grained (`github_pat_...`).
export const githubTokenBody = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\w{1,255}$/, "Doesn't look like a GitHub token"),
});
export type GitHubTokenBody = z.infer<typeof githubTokenBody>;

// A personal access token the user added. Syncs use it instead of the sign in token.
export interface GitHubTokenDto {
  // Null when the token never expires.
  expiresAt: string | null;
  // Empty for fine-grained tokens, which have no scopes.
  scopes: string[];
  // GitHub stopped accepting it. Syncs wait for a new one.
  invalid: boolean;
}

export interface GitHubTokenResponse {
  githubToken: GitHubTokenDto;
}

export interface MeResponse {
  user: {
    id: string;
    login: string;
    name: string | null;
    avatarUrl: string | null;
    // Scopes of the GitHub sign in.
    scopes: string[];
  };
  // The newest, or null when the user hasn't added one. Plan 20's settings page uses
  // `githubTokens`. Removed with the old /github-token routes.
  githubToken: GitHubTokenDto | null;
  githubTokens: TokenDto[];
  // The GitHub sign in stopped working. Sign in again.
  needsReauth: boolean;
  // Can open the admin page.
  isAdmin: boolean;
  // The sign-up request waits for an admin. Every route but this one, sign out, and
  // withdrawing the request answers 403 with code "pending".
  pending: boolean;
}
