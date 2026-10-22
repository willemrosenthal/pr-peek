import { Octokit } from "octokit";
import { vi } from "vitest";

export interface GraphQLRequest {
  query: string;
  variables: Record<string, unknown>;
}

// An Octokit whose GraphQL calls are answered by `answer`, which returns the whole
// response body: `{ data }` for success, or `{ errors }` like GitHub sends.
export function fakeGraphQL(answer: (request: GraphQLRequest) => unknown) {
  const requests: GraphQLRequest[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>((_url, init) => {
    const request = JSON.parse(init?.body as string) as GraphQLRequest;
    requests.push(request);
    return Promise.resolve(Response.json(answer(request)));
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
