import { Octokit } from "octokit";
import { vi } from "vitest";

export interface GraphQLRequest {
  query: string;
  variables: Record<string, unknown>;
}

// An Octokit whose GraphQL calls are answered by `answer`, which returns the whole
// response body: `{ data }` for success, or `{ errors }` like GitHub sends.
// It can also return a Response, to set the status or headers.
export function fakeGraphQL(
  answer: (request: GraphQLRequest) => unknown,
  // Delay before each answer, to make requests overlap in race tests.
  delayMs = 0,
) {
  const requests: GraphQLRequest[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
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
