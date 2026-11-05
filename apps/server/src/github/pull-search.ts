import type { Octokit } from "octokit";
import { z } from "zod";
import { CHECK_COUNTS, checksFingerprint, rawCheckCounts } from "./checks";
import { partialDataOrThrow } from "./errors";

// One PR with just enough to tell if it's open and if it changed.
export interface PrStatus {
  id: string;
  githubRepoId: number;
  state: "OPEN" | "CLOSED" | "MERGED";
  updatedAt: Date;
  // The latest commit's runs counted by state (`checksFingerprint`). Checks can change
  // without `updatedAt` changing.
  checkFingerprint: string | null;
}

const PAGE_SIZE = 100;
// GitHub stops at 1000 search results anyway.
const MAX_PAGES = 10;
// PRs per status request.
const STATUS_BATCH_SIZE = 100;

// Search results are found through GitHub's index, which lags, but their fields are
// read live. So `state` is current even when the index isn't.
const STATUS_FIELDS = `
  id
  state
  updatedAt
  repository { databaseId }
  commits(last: 1) { nodes { commit { statusCheckRollup { ${CHECK_COUNTS} } } } }
`;

const statusNode = z.object({
  id: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  updatedAt: z.string(),
  repository: z.object({ databaseId: z.number() }),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          statusCheckRollup: z.object({ contexts: rawCheckCounts }).nullable(),
        }),
      }),
    ),
  }),
});

type StatusNode = z.infer<typeof statusNode>;

const toStatus = (node: StatusNode): PrStatus => ({
  id: node.id,
  githubRepoId: node.repository.databaseId,
  state: node.state,
  updatedAt: new Date(node.updatedAt),
  checkFingerprint: checksFingerprint(
    node.commits.nodes[0]?.commit.statusCheckRollup?.contexts ?? null,
  ),
});

const searchPage = z.object({
  search: z.object({
    // Search can return other node types as empty objects, so allow and skip them.
    nodes: z.array(z.union([statusNode, z.object({})]).nullable()),
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: z.string().nullable(),
    }),
  }),
});

const SEARCH_QUERY = `query ($q: String!, $cursor: String) {
  search(type: ISSUE, query: $q, first: ${PAGE_SIZE}, after: $cursor) {
    nodes { ... on PullRequest { ${STATUS_FIELDS} } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const STATUS_QUERY = `query ($ids: [ID!]!) {
  nodes(ids: $ids) { ... on PullRequest { ${STATUS_FIELDS} } }
}`;

// Every PR matching one search, newest first.
async function searchAll(octokit: Octokit, q: string): Promise<StatusNode[]> {
  const found: StatusNode[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: unknown = await octokit.graphql(SEARCH_QUERY, {
      q: `is:pr is:open archived:false sort:updated-desc ${q}`,
      cursor,
    });
    const { nodes, pageInfo } = searchPage.parse(data).search;
    found.push(...nodes.filter((n): n is StatusNode => !!n && "id" in n));
    if (!pageInfo.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }
  return found;
}

// The open PRs that involve the user, keyed by PR id.
export async function findRelevantPrs(
  octokit: Octokit,
  options: { includeTeamRequests: boolean },
): Promise<Map<string, PrStatus>> {
  const searches = [
    // `review-requested` also matches requests to the user's teams.
    options.includeTeamRequests
      ? "review-requested:@me"
      : "user-review-requested:@me",
    // PRs the user authored, is assigned to, is mentioned in, or commented on. One search
    // for all four, since each takes a few seconds. Not one request for both searches
    // either: GitHub stops a request that runs over 10 seconds.
    "involves:@me",
  ];

  const prs = new Map<string, PrStatus>();
  for (const q of searches) {
    for (const node of await searchAll(octokit, q)) {
      // The index can still list a PR that just merged.
      if (node.state === "OPEN") prs.set(node.id, toStatus(node));
    }
  }
  return prs;
}

// Each PR's status, read directly by id. Null for PRs that are gone or hidden. PRs in a
// shape we don't expect are left out, so the caller doesn't take them as gone.
export async function fetchPrStatuses(
  octokit: Octokit,
  ids: string[],
): Promise<Map<string, PrStatus | null>> {
  const statuses = new Map<string, PrStatus | null>();
  for (let i = 0; i < ids.length; i += STATUS_BATCH_SIZE) {
    const batch = ids.slice(i, i + STATUS_BATCH_SIZE);
    const data: unknown = await octokit
      .graphql(STATUS_QUERY, { ids: batch })
      // Hidden covers an org that blocks pr-peek after the PR was found.
      .catch((err: unknown) =>
        partialDataOrThrow(err, ["NOT_FOUND", "FORBIDDEN"]),
      );
    const { nodes } = z.object({ nodes: z.array(z.unknown()) }).parse(data);
    batch.forEach((id, index) => {
      const node = nodes[index];
      if (!node) {
        statuses.set(id, null);
        return;
      }
      const parsed = statusNode.safeParse(node);
      if (parsed.success) statuses.set(id, toStatus(parsed.data));
    });
  }
  return statuses;
}
