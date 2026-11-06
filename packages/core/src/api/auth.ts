import { z } from "zod";

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
  // Null when the user hasn't added one.
  githubToken: GitHubTokenDto | null;
  // The GitHub sign in stopped working. Sign in again.
  needsReauth: boolean;
  // Can open the admin page.
  isAdmin: boolean;
}
