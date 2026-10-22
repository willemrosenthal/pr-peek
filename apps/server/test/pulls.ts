import type { GraphQLRequest } from "./github";

const user = (login: string) => ({ __typename: "User", login });
const bot = (login: string) => ({ __typename: "Bot", login });
const team = (combinedSlug: string) => ({ __typename: "Team", combinedSlug });

// One PR as GitHub's details query returns it, with a bit of everything in it.
export function githubPr(overrides: Record<string, unknown> = {}) {
  return {
    id: "PR_1",
    number: 7,
    title: "Add login",
    url: "https://github.com/acme/web-app/pull/7",
    isDraft: false,
    updatedAt: "2026-10-21T10:00:00Z",
    repository: { name: "web-app", owner: { login: "acme" } },
    author: user("sam"),
    reviewRequests: {
      nodes: [
        { requestedReviewer: user("octocat") },
        { requestedReviewer: team("acme/frontend") },
        // A reviewer the token can't see.
        { requestedReviewer: null },
      ],
    },
    timelineItems: {
      nodes: [
        {
          __typename: "ReviewRequestedEvent",
          id: "RRE_1",
          createdAt: "2026-10-21T08:00:00Z",
          requestedReviewer: user("octocat"),
        },
        {
          __typename: "ReviewRequestRemovedEvent",
          id: "RRRE_1",
          createdAt: "2026-10-21T08:30:00Z",
          requestedReviewer: team("acme/backend"),
        },
      ],
    },
    reviews: {
      nodes: [
        {
          id: "R_1",
          state: "APPROVED",
          submittedAt: "2026-10-21T09:00:00Z",
          author: user("jlee"),
        },
        // The viewer's unsent draft review.
        {
          id: "R_2",
          state: "PENDING",
          submittedAt: null,
          author: user("octocat"),
        },
      ],
    },
    reviewThreads: {
      nodes: [
        {
          id: "T_1",
          isResolved: false,
          comments: {
            nodes: [
              {
                id: "C_1",
                author: user("octocat"),
                bodyText: "Why\n\n  this?",
                createdAt: "2026-10-21T09:10:00Z",
                replyTo: null,
              },
              {
                id: "C_2",
                author: bot("renovate"),
                bodyText: "Because.",
                createdAt: "2026-10-21T09:20:00Z",
                replyTo: { id: "C_1" },
              },
            ],
          },
        },
      ],
    },
    comments: {
      nodes: [
        {
          id: "IC_1",
          // A deleted account.
          author: null,
          // The mention is past the 200 character preview.
          bodyText: `${"a".repeat(250)} @OctoCat can you look?`,
          createdAt: "2026-10-21T09:30:00Z",
        },
      ],
    },
    commits: {
      nodes: [
        {
          commit: {
            oid: "abc123",
            committedDate: "2026-10-21T07:00:00Z",
            statusCheckRollup: {
              state: "FAILURE",
              contexts: {
                nodes: [
                  {
                    __typename: "CheckRun",
                    name: "lint",
                    conclusion: "FAILURE",
                    detailsUrl: "https://ci.example/lint",
                  },
                  {
                    __typename: "CheckRun",
                    name: "unit",
                    conclusion: "SUCCESS",
                    detailsUrl: "https://ci.example/unit",
                  },
                  // Still running.
                  {
                    __typename: "CheckRun",
                    name: "deploy",
                    conclusion: null,
                    detailsUrl: null,
                  },
                  {
                    __typename: "StatusContext",
                    context: "e2e",
                    state: "ERROR",
                    targetUrl: null,
                  },
                ],
              },
            },
          },
        },
      ],
    },
    ...overrides,
  };
}

// One PR as the search query returns it.
export function searchHit(
  id: string,
  options: { repoId?: number; updatedAt?: string; checkState?: string } = {},
) {
  return {
    id,
    updatedAt: options.updatedAt ?? "2026-10-21T10:00:00Z",
    repository: { databaseId: options.repoId ?? 1 },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: options.checkState
              ? { state: options.checkState }
              : null,
          },
        },
      ],
    },
  };
}

export interface FakePrGitHub {
  // Search results by which search ran. Each is one page.
  reviewRequested?: unknown[];
  authored?: unknown[];
  commented?: unknown[];
  // Details by PR id. Missing ids answer null, like a deleted PR.
  prs?: Record<string, unknown>;
}

// Answers the PR searches and details queries like GitHub.
export function prGitHub(fake: FakePrGitHub) {
  return (request: GraphQLRequest) => {
    if (request.query.includes("search(")) {
      const q = String(request.variables.q);
      const nodes = q.includes("review-requested:@me")
        ? fake.reviewRequested
        : q.includes("commenter:@me")
          ? fake.commented
          : fake.authored;
      return {
        data: {
          search: {
            nodes: nodes ?? [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      };
    }
    const ids = request.variables.ids as string[];
    return { data: { nodes: ids.map((id) => fake.prs?.[id] ?? null) } };
  };
}

// The search requests in a list of requests, as their `q` text.
export const searchQueries = (requests: GraphQLRequest[]) =>
  requests
    .filter((r) => r.query.includes("search("))
    .map((r) => String(r.variables.q));

// The PR ids asked for in details requests.
export const detailIds = (requests: GraphQLRequest[]) =>
  requests.flatMap((r) => (r.variables.ids as string[] | undefined) ?? []);
