import { Octokit } from "octokit";
import { vi } from "vitest";

export interface GraphQLRequest {
  query: string;
  variables: Record<string, unknown>;
}

// An Octokit whose GraphQL calls are answered by `answer`, which returns the whole
// response body: `{ data }` for success, or `{ errors }` like GitHub sends.
// It can also return a Response, to set the status or headers. GET /user/repos lists
// private repos of `repoOwners`, one each, for finding a token's owners.
export function fakeGraphQL(
  answer: (request: GraphQLRequest) => unknown,
  // Delay before each answer, to make requests overlap in race tests.
  delayMs = 0,
  repoOwners: string[] = [],
) {
  const requests: GraphQLRequest[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    if (new URL(url).pathname === "/user/repos") {
      return Response.json(
        repoOwners.map((owner) => ({ owner: { login: owner } })),
      );
    }
    const request = JSON.parse(init?.body as string) as GraphQLRequest;
    requests.push(request);
    if (delayMs) await new Promise((done) => setTimeout(done, delayMs));
    const body = answer(request);
    return body instanceof Response ? body : Response.json(body);
  });
  // Throttling spaces requests out to be kind to GitHub. Not needed for a fake.
  const octokit = new Octokit({
    auth: "test-token",
    request: { fetch },
    throttle: { enabled: false },
  });
  return { octokit, requests };
}

export const notFoundError = {
  data: null,
  errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository" }],
};

// An Octokit whose GET /user/repos answers with `pages`, linked like GitHub links them.
export function reposGitHub(pages: string[][]) {
  const fetch = vi.fn<typeof globalThis.fetch>((input) => {
    const url = new URL(input);
    const page = Number(url.searchParams.get("page") ?? "1");
    const next = new URL(url);
    next.searchParams.set("page", String(page + 1));
    return Promise.resolve(
      Response.json(
        (pages[page - 1] ?? []).map((owner) => ({ owner: { login: owner } })),
        page < pages.length
          ? { headers: { link: `<${next.href}>; rel="next"` } }
          : {},
      ),
    );
  });
  const octokit = new Octokit({
    auth: "test-token",
    request: { fetch },
    throttle: { enabled: false },
  });
  return { octokit, fetch };
}
