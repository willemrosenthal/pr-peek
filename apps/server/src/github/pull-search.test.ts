import { describe, expect, it } from "vitest";
import { fakeGraphQL } from "../../test/github";
import { prGitHub, searchHit, searchQueries } from "../../test/pulls";
import { fetchPrStatuses, findRelevantPrs } from "./pull-search";

describe("findRelevantPrs", () => {
  it("runs the three searches and merges the results by PR", async () => {
    const { octokit, requests } = fakeGraphQL(
      prGitHub({
        reviewRequested: [searchHit("PR_1"), {}, null],
        authored: [
          searchHit("PR_2", { repoId: 2, checkState: "FAILURE" }),
          searchHit("PR_1"),
        ],
        commented: [searchHit("PR_3")],
      }),
    );

    const prs = await findRelevantPrs(octokit, { includeTeamRequests: true });

    expect(searchQueries(requests)).toEqual([
      "is:pr is:open archived:false sort:updated-desc review-requested:@me",
      "is:pr is:open archived:false sort:updated-desc author:@me",
      "is:pr is:open archived:false sort:updated-desc commenter:@me -author:@me",
    ]);
    expect([...prs.keys()]).toEqual(["PR_1", "PR_2", "PR_3"]);
    expect(prs.get("PR_2")).toEqual({
      id: "PR_2",
      githubRepoId: 2,
      state: "OPEN",
      updatedAt: new Date("2026-10-21T10:00:00Z"),
      checkState: "FAILURE",
    });
    expect(prs.get("PR_3")?.checkState).toBeNull();
  });

  it("skips PRs the search index still lists after they merge", async () => {
    const { octokit } = fakeGraphQL(
      prGitHub({
        authored: [searchHit("PR_1", { state: "MERGED" }), searchHit("PR_2")],
      }),
    );
    const prs = await findRelevantPrs(octokit, { includeTeamRequests: true });
    expect([...prs.keys()]).toEqual(["PR_2"]);
  });

  it("only asks for direct review requests when team requests are off", async () => {
    const { octokit, requests } = fakeGraphQL(prGitHub({}));
    await findRelevantPrs(octokit, { includeTeamRequests: false });
    expect(searchQueries(requests)[0]).toMatch(/ user-review-requested:@me$/);
  });

  it("follows pages, up to 10 per search", async () => {
    const { octokit, requests } = fakeGraphQL((request) => ({
      data: {
        search: {
          nodes: [searchHit(`PR_${String(request.variables.cursor)}`)],
          pageInfo: { hasNextPage: true, endCursor: "next" },
        },
      },
    }));

    await findRelevantPrs(octokit, { includeTeamRequests: true });

    expect(requests).toHaveLength(30);
    expect(requests.slice(0, 2).map((r) => r.variables.cursor)).toEqual([
      null,
      "next",
    ]);
  });
});

describe("fetchPrStatuses", () => {
  it("reads each PR's state by id, and null for ones that are gone", async () => {
    const { octokit } = fakeGraphQL(
      prGitHub({
        statuses: {
          PR_1: searchHit("PR_1"),
          PR_2: searchHit("PR_2", { state: "MERGED" }),
        },
      }),
    );
    const statuses = await fetchPrStatuses(octokit, ["PR_1", "PR_2", "PR_3"]);
    expect(statuses.get("PR_1")?.state).toBe("OPEN");
    expect(statuses.get("PR_2")?.state).toBe("MERGED");
    expect(statuses.get("PR_3")).toBeNull();
  });

  it("leaves out PRs in a shape it doesn't expect, so they stay tracked", async () => {
    const { octokit } = fakeGraphQL(
      prGitHub({
        statuses: { PR_1: { ...searchHit("PR_1"), state: "DRAFT" } },
      }),
    );
    const statuses = await fetchPrStatuses(octokit, ["PR_1"]);
    expect(statuses.has("PR_1")).toBe(false);
  });

  it.each(["NOT_FOUND", "FORBIDDEN"])(
    "treats PRs GitHub answers %s for as gone",
    async (type) => {
      const { octokit } = fakeGraphQL(() => ({
        data: { nodes: [searchHit("PR_1"), null] },
        errors: [{ type, message: "Can't read it" }],
      }));
      const statuses = await fetchPrStatuses(octokit, ["PR_1", "PR_2"]);
      expect(statuses.get("PR_1")?.state).toBe("OPEN");
      expect(statuses.get("PR_2")).toBeNull();
    },
  );

  it("fails on other errors", async () => {
    const { octokit } = fakeGraphQL(() => ({
      data: null,
      errors: [{ type: "RATE_LIMITED", message: "Slow down" }],
    }));
    await expect(fetchPrStatuses(octokit, ["PR_1"])).rejects.toThrow();
  });

  it("asks for nothing when there are no PRs", async () => {
    const { octokit, requests } = fakeGraphQL(prGitHub({}));
    expect(await fetchPrStatuses(octokit, [])).toEqual(new Map());
    expect(requests).toEqual([]);
  });
});
