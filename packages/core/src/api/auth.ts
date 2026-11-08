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

export interface MeResponse {
  user: {
    id: string;
    login: string;
    name: string | null;
    avatarUrl: string | null;
    // Scopes of the GitHub sign in.
    scopes: string[];
  };
  // The user's personal access tokens, oldest first.
  githubTokens: TokenDto[];
  // The GitHub sign in stopped working. Sign in again.
  needsReauth: boolean;
  // Can open the admin page.
  isAdmin: boolean;
  // The sign-up request waits for an admin. Every route but this one, sign out, and
  // withdrawing the request answers 403 with code "pending".
  pending: boolean;
}
