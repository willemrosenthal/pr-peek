import { describe, expect, it } from "vitest";
import { fakeGraphQL, notFoundError } from "../../test/github";
import { fetchViewerTeams } from "./teams";

const org = (...slugs: string[]) => ({
  teams: { nodes: slugs.map((combinedSlug) => ({ combinedSlug })) },
});

describe("fetchViewerTeams", () => {
  it("lists the user's teams across orgs", async () => {
    const { octokit, requests } = fakeGraphQL(() => ({
      data: {
        viewer: {
          organizations: {
            nodes: [org("acme/web", "acme/api"), org(), org("beta/core")],
          },
        },
      },
    }));

    expect(await fetchViewerTeams(octokit, "octocat")).toEqual([
      "acme/web",
      "acme/api",
      "beta/core",
    ]);
    expect(requests[0]?.variables).toEqual({ login: "octocat" });
  });

  it("keeps the orgs it can read when others are hidden", async () => {
    const { octokit } = fakeGraphQL(() => ({
      data: { viewer: { organizations: { nodes: [org("acme/web"), null] } } },
      errors: [{ type: "FORBIDDEN", message: "Resource not accessible" }],
    }));
    expect(await fetchViewerTeams(octokit, "octocat")).toEqual(["acme/web"]);
  });

  it("is empty when the token can't read teams", async () => {
    const { octokit } = fakeGraphQL(() => ({
      data: null,
      errors: [{ type: "INSUFFICIENT_SCOPES", message: "Needs read:org" }],
    }));
    expect(await fetchViewerTeams(octokit, "octocat")).toEqual([]);
  });

  it("throws other errors", async () => {
    const { octokit } = fakeGraphQL(() => ({
      ...notFoundError,
      errors: [{ type: "SERVICE_UNAVAILABLE", message: "Try again" }],
    }));
    await expect(fetchViewerTeams(octokit, "octocat")).rejects.toThrow(
      "Try again",
    );
  });
});
