import { z } from "zod";

// A GitHub personal access token, classic (`ghp_...`) or fine-grained (`github_pat_...`).
export const tokenSignInBody = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\w{1,255}$/, "Doesn't look like a GitHub token"),
});
export type TokenSignInBody = z.infer<typeof tokenSignInBody>;

export interface TokenSignInResponse {
  // True the first time this GitHub account signs in. The app shows onboarding.
  isNew: boolean;
}
