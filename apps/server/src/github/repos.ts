import type { RepoOption, RepoOwner, SearchReposResponse } from "@pr-peek/core";
import type { Octokit } from "octokit";
import { z } from "zod";
import { isNotFound, partialDataOrThrow } from "./errors";

// Lists are filtered in the browser, so they come in big pages. Search shows a few.
const LIST_PAGE_SIZE = 100;
const SEARCH_PAGE_SIZE = 20;

// Archived repos are left out by each query, so their flag isn't needed.
const REPO_FIELDS = `databaseId name owner { login } isPrivate isFork pushedAt`;

const repoNode = z.object({
  databaseId: z.number(),
  name: z.string(),
  owner: z.object({ login: z.string() }),
  isPrivate: z.boolean(),
  isFork: z.boolean(),
  pushedAt: z.string().nullable(),
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

// Asks GitHub for a list. An org that blocks Git Buddy comes back as null items and
// FORBIDDEN errors, which Octokit throws on. Keep the rest of the list instead.
const askForList = (
  octokit: Octokit,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<unknown> =>
  octokit
    .graphql(query, variables)
    .catch((err: unknown) => partialDataOrThrow(err, ["FORBIDDEN"]));

function toRepoOption(node: RepoNode): RepoOption {
  return {
    githubRepoId: node.databaseId,
    owner: node.owner.login,
    name: node.name,
    isPrivate: node.isPrivate,
    isFork: node.isFork,
    pushedAt: node.pushedAt,
  };
}

function toPage(raw: z.infer<typeof page>): SearchReposResponse {
  const repos = raw.nodes
    .filter((node): node is RepoNode => !!node && "databaseId" in node)
    .map(toRepoOption);
  return {
    repos,
    nextCursor: raw.pageInfo.hasNextPage ? raw.pageInfo.endCursor : null,
  };
}

// Repos the user can add, most recently pushed first. With an owner, only theirs.
// Null if no user or org has that name.
export async function listRepos(
  octokit: Octokit,
  options: { owner?: string | undefined; cursor?: string | undefined },
): Promise<SearchReposResponse | null> {
  const cursor = options.cursor ?? null;
  const args = `first: ${LIST_PAGE_SIZE}, after: $cursor, isArchived: false,
    orderBy: { field: PUSHED_AT, direction: DESC }`;

  if (!options.owner) {
    // Only ownerAffiliations. Adding `affiliations` makes GitHub return the personal
    // repos of everyone in the user's orgs, which can be over 100,000.
    const data = await askForList(
      octokit,
      `query ($cursor: String) {
        viewer {
          repositories(${args}, ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]) {
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

  const data = await askForList(
    octokit,
    `query ($owner: String!, $cursor: String) {
      repositoryOwner(login: $owner) {
        repositories(${args}, ownerAffiliations: [OWNER]) {
          nodes { ${REPO_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`,
    { owner: options.owner, cursor },
  );
  const { repositoryOwner } = z
    .object({
      repositoryOwner: z.object({ repositories: page }).nullable(),
    })
    .parse(data);
  return repositoryOwner && toPage(repositoryOwner.repositories);
}

// Searches repos the user can see by name. With an owner, only theirs.
export async function searchRepos(
  octokit: Octokit,
  options: {
    query: string;
    owner?: string | undefined;
    cursor?: string | undefined;
  },
): Promise<SearchReposResponse> {
  // `user:` matches orgs too.
  const owner = options.owner ? ` user:${options.owner}` : "";
  const data = await askForList(
    octokit,
    `query ($q: String!, $cursor: String) {
      search(type: REPOSITORY, query: $q, first: ${SEARCH_PAGE_SIZE}, after: $cursor) {
        nodes { ... on Repository { ${REPO_FIELDS} } }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    {
      q: `${options.query} in:name archived:false${owner}`,
      cursor: options.cursor ?? null,
    },
  );
  return toPage(z.object({ search: page }).parse(data).search);
}

const login = z.object({ login: z.string() });

// The owners to pick from: the user, their orgs, then owners of repos shared with them.
export async function listOwners(octokit: Octokit): Promise<RepoOwner[]> {
  // Shared owners come from the first 100 shared repos, which covers nearly everyone.
  const data = await askForList(
    octokit,
    `query {
      viewer {
        login
        organizations(first: 100) { nodes { login } }
        repositories(first: 100, ownerAffiliations: [COLLABORATOR]) {
          nodes { owner { login } }
        }
      }
    }`,
  );
  const { viewer } = z
    .object({
      viewer: z.object({
        login: z.string(),
        organizations: z.object({ nodes: z.array(login.nullable()) }),
        repositories: z.object({
          nodes: z.array(z.object({ owner: login }).nullable()),
        }),
      }),
    })
    .parse(data);

  const byName = (a: string, b: string) =>
    a.localeCompare(b, undefined, { sensitivity: "base" });
  const orgs = viewer.organizations.nodes
    .flatMap((org) => (org ? [org.login] : []))
    .sort(byName);
  // GitHub logins ignore case.
  const seen = new Set(
    [viewer.login, ...orgs].map((name) => name.toLowerCase()),
  );
  const shared = [
    ...new Set(
      viewer.repositories.nodes.flatMap((repo) =>
        repo ? [repo.owner.login] : [],
      ),
    ),
  ]
    .filter((name) => !seen.has(name.toLowerCase()))
    .sort(byName);

  return [
    { login: viewer.login, kind: "you" },
    ...orgs.map((name): RepoOwner => ({ login: name, kind: "org" })),
    ...shared.map((name): RepoOwner => ({ login: name, kind: "shared" })),
  ];
}

// Pages of 100 repos read when finding a token's owners. 1,000 private repos is plenty.
const OWNER_PAGES = 10;

// The users and orgs whose private repos the client's token reaches. Private only: any
// token reads public repos, so those say nothing about what it was made for.
export async function listTokenOwners(octokit: Octokit): Promise<string[]> {
  const owners = new Set<string>();
  let pages = 0;
  for await (const { data } of octokit.paginate.iterator("GET /user/repos", {
    visibility: "private",
    per_page: 100,
  })) {
    for (const repo of data) owners.add(repo.owner.login);
    if (++pages >= OWNER_PAGES) break;
  }
  return [...owners].sort();
}

// Looks up one repo. Null if it doesn't exist or the user can't see it.
export async function findRepo(
  octokit: Octokit,
  owner: string,
  name: string,
): Promise<RepoOption | null> {
  try {
    const data = await octokit.graphql(
      `query ($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) { ${REPO_FIELDS} }
      }`,
      { owner, name },
    );
    return toRepoOption(
      z.object({ repository: repoNode }).parse(data).repository,
    );
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}
