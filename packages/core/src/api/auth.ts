import { z } from "zod";

// A GitHub personal access token, classic (`ghp_...`) or fine-grained (`github_pat_...`).
export const tokenSignInBody = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\w{1,255}$/, "Doesn't look like a GitHub token"),
});
export type TokenSignInBody = z.infer<typeof tokenSignInBody>;

export interface MeResponse {
  user: {
    id: string;
    login: string;
    name: string | null;
    avatarUrl: string | null;
    // "oauth" (the GitHub button) or "pat" (a pasted token).
    authMethod: string;
    scopes: string[];
  };
  // The GitHub token stopped working. Sign in again, or paste a new token.
  needsReauth: boolean;
}

export interface TokenSignInResponse {
  // True the first time this GitHub account signs in. The app shows onboarding.
  isNew: boolean;
}
