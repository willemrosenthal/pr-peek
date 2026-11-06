import { Octokit } from "octokit";
import type { Usage } from "../usage";
import { getAccessToken, markNeedsReauth, type TokenDeps } from "./tokens";

// Longer waits fail the request instead, and the sync tries again later.
const MAX_RATE_LIMIT_WAIT_S = 60;

// Retries once when GitHub asks us to slow down, if the wait is short.
const retryIfShort = (
  retryAfter: number,
  _options: unknown,
  _octokit: unknown,
  retryCount: number,
) => retryCount === 0 && retryAfter <= MAX_RATE_LIMIT_WAIT_S;

export interface ClientDeps extends TokenDeps {
  // Lets tests stand in for GitHub's API.
  fetch?: typeof fetch;
  // Counts requests for the admin page.
  usage?: Usage | undefined;
}

// GitHub's answer to too many requests: 429, or 403 with no budget left or a wait.
export const isRateLimited = (
  status: number,
  headers: Record<string, unknown>,
) =>
  status === 429 ||
  (status === 403 &&
    (headers["x-ratelimit-remaining"] === "0" || "retry-after" in headers));

// Counts each request, the lowest budget left, and rate limited answers, as "github".
function countRequests(octokit: Octokit, usage: Usage) {
  octokit.hook.after("request", (response) => {
    usage.add("github", "requests");
    const left = Number(response.headers["x-ratelimit-remaining"]);
    if (Number.isFinite(left)) usage.add("github", "budget", { low: left });
  });
  octokit.hook.error("request", (error) => {
    usage.add("github", "requests");
    if ("status" in error && "response" in error) {
      const headers = (error.response?.headers ?? {}) as Record<
        string,
        unknown
      >;
      if (isRateLimited(error.status, headers)) {
        usage.add("github", "rate_limited");
      }
    }
    throw error;
  });
}

// A GitHub API client acting as the user. It comes with retries and rate limit handling.
// Create one per sync: the token is checked, and refreshed if needed, when it's made.
export async function getOctokit(
  deps: ClientDeps,
  userId: string,
): Promise<Octokit> {
  const octokit = new Octokit({
    auth: await getAccessToken(deps, userId),
    throttle: {
      onRateLimit: retryIfShort,
      onSecondaryRateLimit: retryIfShort,
    },
    ...(deps.fetch && { request: { fetch: deps.fetch } }),
  });

  // 401 means GitHub no longer accepts the token (the user revoked the app).
  octokit.hook.error("request", async (error) => {
    if ("status" in error && error.status === 401) {
      await markNeedsReauth(deps.db, userId);
    }
    throw error;
  });

  if (deps.usage) countRequests(octokit, deps.usage);
  return octokit;
}
