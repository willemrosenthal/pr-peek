import { describe, expect, it } from "vitest";
import { fakeGraphQL } from "../../test/github";
import { prGitHub, searchHit, searchQueries } from "../../test/pulls";
import { findRelevantPrs } from "./pull-search";

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
    expect(prs.get("PR_1")?.reasons).toEqual(
      new Set(["review_requested", "authored"]),
    );
    expect(prs.get("PR_2")).toEqual({
      id: "PR_2",
      githubRepoId: 2,
      updatedAt: new Date("2026-10-21T10:00:00Z"),
      checkState: "FAILURE",
      reasons: new Set(["authored"]),
    });
    expect(prs.get("PR_3")?.checkState).toBeNull();
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
