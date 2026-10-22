import { checkState, type CheckState } from "@pr-peek/core";
import type { Octokit } from "octokit";
import { z } from "zod";

// Why a PR showed up: which searches found it.
export type PrReason = "review_requested" | "authored" | "commented";

// One open PR from the searches, with just enough to tell if it changed.
export interface FoundPr {
  id: string;
  githubRepoId: number;
  updatedAt: Date;
  // The latest commit's checks. They can change without `updatedAt` changing.
  checkState: CheckState | null;
  reasons: Set<PrReason>;
}

const PAGE_SIZE = 100;
// GitHub stops at 1000 search results anyway.
const MAX_PAGES = 10;

const prNode = z.object({
  id: z.string(),
  updatedAt: z.string(),
  repository: z.object({ databaseId: z.number() }),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          statusCheckRollup: z.object({ state: checkState }).nullable(),
        }),
      }),
    ),
  }),
});

const searchPage = z.object({
  search: z.object({
    // Search can return other node types as empty objects, so allow and skip them.
    nodes: z.array(z.union([prNode, z.object({})]).nullable()),
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: z.string().nullable(),
    }),
  }),
});

type PrNode = z.infer<typeof prNode>;

const SEARCH_QUERY = `query ($q: String!, $cursor: String) {
  search(type: ISSUE, query: $q, first: ${PAGE_SIZE}, after: $cursor) {
    nodes {
      ... on PullRequest {
        id
        updatedAt
        repository { databaseId }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

// Every open PR matching one search, newest first.
async function searchAll(octokit: Octokit, q: string): Promise<PrNode[]> {
  const found: PrNode[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: unknown = await octokit.graphql(SEARCH_QUERY, {
      q: `is:pr is:open archived:false sort:updated-desc ${q}`,
      cursor,
    });
    const { nodes, pageInfo } = searchPage.parse(data).search;
    found.push(...nodes.filter((n): n is PrNode => !!n && "id" in n));
    if (!pageInfo.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }
  return found;
}

// The open PRs that involve the user, merged into one list keyed by PR id.
export async function findRelevantPrs(
  octokit: Octokit,
  options: { includeTeamRequests: boolean },
): Promise<Map<string, FoundPr>> {
  const searches: [PrReason, string][] = [
    [
      "review_requested",
      // `review-requested` also matches requests to the user's teams.
      options.includeTeamRequests
        ? "review-requested:@me"
        : "user-review-requested:@me",
    ],
    ["authored", "author:@me"],
    ["commented", "commenter:@me -author:@me"],
  ];

  const prs = new Map<string, FoundPr>();
  for (const [reason, q] of searches) {
    for (const node of await searchAll(octokit, q)) {
      const existing = prs.get(node.id);
      if (existing) {
        existing.reasons.add(reason);
        continue;
      }
      prs.set(node.id, {
        id: node.id,
        githubRepoId: node.repository.databaseId,
        updatedAt: new Date(node.updatedAt),
        checkState:
          node.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
        reasons: new Set([reason]),
      });
    }
  }
  return prs;
}
