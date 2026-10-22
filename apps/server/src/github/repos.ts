import type { Octokit } from "octokit";
import { z } from "zod";

export interface GitHubRepo {
  githubRepoId: number;
  owner: string;
  name: string;
  isPrivate: boolean;
}

export interface GitHubRepoPage {
  repos: GitHubRepo[];
  nextCursor: string | null;
}

const PAGE_SIZE = 20;

const REPO_FIELDS = `databaseId name owner { login } isPrivate isArchived`;

const repoNode = z.object({
  databaseId: z.number(),
  name: z.string(),
  owner: z.object({ login: z.string() }),
  isPrivate: z.boolean(),
  isArchived: z.boolean(),
});

const page = z.object({
  // Search can return other node types as empty objects, so allow and skip them.
  nodes: z.array(z.union([repoNode, z.object({})]).nullable()),
  pageInfo: z.object({
    hasNextPage: z.boolean(),
    endCursor: z.string().nullable(),
  }),
});

type RepoNode = z.infer<typeof repoNode>;

function toGitHubRepo(node: RepoNode): GitHubRepo {
  return {
    githubRepoId: node.databaseId,
    owner: node.owner.login,
    name: node.name,
    isPrivate: node.isPrivate,
  };
}

function toPage(raw: z.infer<typeof page>): GitHubRepoPage {
  const repos = raw.nodes
    .filter((node): node is RepoNode => !!node && "databaseId" in node)
    .filter((node) => !node.isArchived)
    .map(toGitHubRepo);
  return {
    repos,
    nextCursor: raw.pageInfo.hasNextPage ? raw.pageInfo.endCursor : null,
  };
}

// The user's repos, most recently pushed first. With a query, searches repos they can see by name.
export async function searchRepos(
  octokit: Octokit,
  options: { query?: string | undefined; cursor?: string | undefined },
): Promise<GitHubRepoPage> {
  const cursor = options.cursor ?? null;

  if (!options.query) {
    const data = await octokit.graphql(
      `query ($cursor: String) {
        viewer {
          repositories(
            first: ${PAGE_SIZE}
            after: $cursor
            affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
            orderBy: { field: PUSHED_AT, direction: DESC }
          ) {
            nodes { ${REPO_FIELDS} }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { cursor },
    );
    return toPage(
      z.object({ viewer: z.object({ repositories: page }) }).parse(data).viewer
        .repositories,
    );
  }

  const data = await octokit.graphql(
    `query ($q: String!, $cursor: String) {
      search(type: REPOSITORY, query: $q, first: ${PAGE_SIZE}, after: $cursor) {
        nodes { ... on Repository { ${REPO_FIELDS} } }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    { q: `${options.query} in:name archived:false`, cursor },
  );
  return toPage(z.object({ search: page }).parse(data).search);
}

// Looks up one repo. Null if it doesn't exist or the user can't see it.
export async function findRepo(
  octokit: Octokit,
  owner: string,
  name: string,
): Promise<GitHubRepo | null> {
  try {
    const data = await octokit.graphql(
      `query ($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) { ${REPO_FIELDS} }
      }`,
      { owner, name },
    );
    return toGitHubRepo(
      z.object({ repository: repoNode }).parse(data).repository,
    );
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

// GitHub answers an unknown or hidden repo with a GraphQL error of type NOT_FOUND.
function isNotFound(err: unknown): boolean {
  const errors = (err as { errors?: { type?: string }[] }).errors;
  return Array.isArray(errors) && errors.some((e) => e.type === "NOT_FOUND");
}
