import { Octokit } from "octokit";
import { getAccessToken, markNeedsReauth, type TokenDeps } from "./tokens";

export interface ClientDeps extends TokenDeps {
  // Lets tests stand in for GitHub's API.
  fetch?: typeof fetch;
}

// A GitHub API client acting as the user. It comes with retries and rate limit handling.
// Create one per sync: the token is checked, and refreshed if needed, when it's made.
export async function getOctokit(
  deps: ClientDeps,
  userId: string,
): Promise<Octokit> {
  const octokit = new Octokit({
    auth: await getAccessToken(deps, userId),
    ...(deps.fetch && { request: { fetch: deps.fetch } }),
  });

  // 401 means GitHub no longer accepts the token (the user revoked the app).
  octokit.hook.error("request", async (error) => {
    if ("status" in error && error.status === 401) {
      await markNeedsReauth(deps.db, userId);
    }
    throw error;
  });

  return octokit;
}
