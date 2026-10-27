import { prSnapshot, type PrSnapshot } from "@pr-peek/core";
import { describe, expect, it } from "vitest";
import { fakeGraphQL } from "../../test/github";
import { detailIds, githubPr, prGitHub, recentCommit } from "../../test/pulls";
import { fetchPrDetails, mentionsIn, preview } from "./pull-details";

// A PR's head commit, with these checks.
const withHeadChecks = (statusCheckRollup: unknown) => ({
  commits: {
    nodes: [
      {
        commit: {
          oid: "abc123",
          committedDate: "2026-10-21T07:00:00Z",
          statusCheckRollup,
        },
      },
    ],
  },
});

describe("fetchPrDetails", () => {
  it("turns GitHub's answer into a snapshot", async () => {
    const { octokit } = fakeGraphQL(prGitHub({ prs: { PR_1: githubPr() } }));
    const { snapshots, failed } = await fetchPrDetails(octokit, ["PR_1"]);

    expect(failed).toEqual([]);
    expect(snapshots).toEqual<PrSnapshot[]>([
      {
        id: "PR_1",
        number: 7,
        repo: { owner: "acme", name: "web-app" },
        title: "Add login",
        url: "https://github.com/acme/web-app/pull/7",
        author: { login: "sam", isBot: false },
        isDraft: false,
        headSha: "abc123",
        headCommittedAt: "2026-10-21T07:00:00Z",
        updatedAt: "2026-10-21T10:00:00Z",
        reviewRequests: [
          { type: "user", login: "octocat" },
          { type: "team", slug: "acme/frontend" },
        ],
        reviewRequestEvents: [
          {
            id: "RRE_1",
            action: "requested",
            reviewer: { type: "user", login: "octocat" },
            createdAt: "2026-10-21T08:00:00Z",
          },
          {
            id: "RRRE_1",
            action: "removed",
            reviewer: { type: "team", slug: "acme/backend" },
            createdAt: "2026-10-21T08:30:00Z",
          },
        ],
        reviews: [
          {
            id: "R_1",
            author: { login: "jlee", isBot: false },
            state: "APPROVED",
            submittedAt: "2026-10-21T09:00:00Z",
            bodyPreview: "Looks good, @sam",
            mentions: ["sam"],
          },
        ],
        threads: [
          {
            id: "T_1",
            isResolved: false,
            comments: [
              {
                id: "C_1",
                author: { login: "octocat", isBot: false },
                bodyPreview: "Why this?",
                mentions: [],
                createdAt: "2026-10-21T07:50:00Z",
                replyToId: null,
              },
              {
                id: "C_2",
                author: { login: "renovate", isBot: true },
                bodyPreview: "Because.",
                mentions: [],
                createdAt: "2026-10-21T09:20:00Z",
                replyToId: "C_1",
              },
            ],
          },
        ],
        comments: [
          {
            id: "IC_1",
            author: { login: "ghost", isBot: false },
            bodyPreview: "a".repeat(200),
            mentions: ["octocat"],
            createdAt: "2026-10-21T09:30:00Z",
            replyToId: null,
          },
        ],
        description: {
          id: "body:PR_1",
          author: { login: "sam", isBot: false },
          bodyPreview: "Adds a login page.",
          mentions: [],
          createdAt: "2026-10-21T06:00:00Z",
          replyToId: null,
        },
        checks: {
          state: "FAILURE",
          failing: [
            { name: "lint", url: "https://ci.example/lint" },
            { name: "e2e", url: null },
          ],
        },
        lastPush: {
          sha: "abc123",
          committedAt: "2026-10-21T07:00:00Z",
          checksFailed: true,
        },
      },
    ]);
    // Plan 05 reads saved snapshots back with the shared schema.
    expect(prSnapshot.parse(snapshots[0])).toEqual(snapshots[0]);
  });

  it("handles a commit with no checks", async () => {
    const pr = githubPr(withHeadChecks(null));
    const { octokit } = fakeGraphQL(prGitHub({ prs: { PR_1: pr } }));
    const { snapshots } = await fetchPrDetails(octokit, ["PR_1"]);
    expect(snapshots[0]?.checks).toEqual({ state: null, failing: [] });
  });

  it("takes the last push from the newest commit that isn't a merge", async () => {
    const pr = githubPr({
      recentCommits: {
        nodes: [
          recentCommit("old", "2026-10-21T06:00:00Z", "SUCCESS"),
          recentCommit("push", "2026-10-21T07:00:00Z", "FAILURE"),
          // "Update branch".
          recentCommit("merge", "2026-10-21T08:00:00Z", "PENDING", 2),
        ],
      },
    });
    const { octokit } = fakeGraphQL(prGitHub({ prs: { PR_1: pr } }));
    const { snapshots } = await fetchPrDetails(octokit, ["PR_1"]);
    expect(snapshots[0]?.lastPush).toEqual({
      sha: "push",
      committedAt: "2026-10-21T07:00:00Z",
      checksFailed: true,
    });
  });

  it.each([
    ["a cancelled run", "CANCELLED", false],
    ["a passing run", "SUCCESS", false],
    ["no checks", null, false],
    ["a timed out run", "TIMED_OUT", true],
  ])(
    "says whether the last push's checks failed, for %s",
    async (_, checkRun, failed) => {
      const pr = githubPr({
        recentCommits: {
          nodes: [recentCommit("push", "2026-10-21T07:00:00Z", checkRun)],
        },
      });
      const { octokit } = fakeGraphQL(prGitHub({ prs: { PR_1: pr } }));
      const { snapshots } = await fetchPrDetails(octokit, ["PR_1"]);
      expect(snapshots[0]?.lastPush?.checksFailed).toBe(failed);
    },
  );

  it("counts a failed status as a failed check on the last push", async () => {
    const push = recentCommit("push", "2026-10-21T07:00:00Z", "SUCCESS");
    push.commit.statusCheckRollup!.contexts.statusContextCountsByState = [
      { state: "ERROR", count: 1 },
    ];
    const pr = githubPr({ recentCommits: { nodes: [push] } });
    const { octokit } = fakeGraphQL(prGitHub({ prs: { PR_1: pr } }));
    const { snapshots } = await fetchPrDetails(octokit, ["PR_1"]);
    expect(snapshots[0]?.lastPush?.checksFailed).toBe(true);
  });

  it("leaves the last push out when every recent commit is a merge", async () => {
    const pr = githubPr({
      recentCommits: {
        nodes: [recentCommit("merge", "2026-10-21T08:00:00Z", null, 2)],
      },
    });
    const { octokit } = fakeGraphQL(prGitHub({ prs: { PR_1: pr } }));
    const { snapshots } = await fetchPrDetails(octokit, ["PR_1"]);
    expect(snapshots[0]).not.toHaveProperty("lastPush");
    // Like snapshots stored before `lastPush` was added, it still reads back.
    expect(prSnapshot.parse(snapshots[0])).toEqual(snapshots[0]);
  });

  it("asks for 10 PRs at a time", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `PR_${i}`);
    const prs = Object.fromEntries(ids.map((id) => [id, githubPr({ id })]));
    const { octokit, requests } = fakeGraphQL(prGitHub({ prs }));

    const { snapshots } = await fetchPrDetails(octokit, ids);

    expect(requests.map((r) => (r.variables.ids as string[]).length)).toEqual([
      10, 2,
    ]);
    expect(detailIds(requests)).toEqual(ids);
    expect(snapshots).toHaveLength(12);
  });

  it("skips PRs that are gone or unreadable, and keeps the rest", async () => {
    const { octokit } = fakeGraphQL(
      prGitHub({
        prs: {
          PR_1: githubPr(),
          PR_2: githubPr({ id: "PR_2", number: "not a number" }),
        },
      }),
    );

    const { snapshots, failed } = await fetchPrDetails(octokit, [
      "PR_1",
      "PR_2",
      "PR_3",
    ]);

    expect(snapshots.map((s) => s.id)).toEqual(["PR_1"]);
    expect(failed).toEqual([
      { id: "PR_2", error: expect.stringContaining("number") as string },
      { id: "PR_3", error: "not found" },
    ]);
  });

  it("keeps the other PRs when GitHub reports one as not found", async () => {
    const { octokit } = fakeGraphQL(() => ({
      data: { nodes: [githubPr(), null] },
      errors: [{ type: "NOT_FOUND", message: "Could not resolve to a node" }],
    }));

    const { snapshots, failed } = await fetchPrDetails(octokit, [
      "PR_1",
      "PR_gone",
    ]);

    expect(snapshots.map((s) => s.id)).toEqual(["PR_1"]);
    expect(failed).toEqual([{ id: "PR_gone", error: "not found" }]);
  });

  it("skips check runs hidden from a fine-grained token, and keeps statuses", async () => {
    const pr = githubPr(
      withHeadChecks({
        state: "FAILURE",
        contexts: {
          nodes: [
            null,
            {
              __typename: "StatusContext",
              context: "Vercel",
              state: "FAILURE",
              targetUrl: null,
            },
          ],
        },
      }),
    );
    const { octokit } = fakeGraphQL(() => ({
      data: { nodes: [pr] },
      errors: [
        {
          type: "FORBIDDEN",
          path: [
            "nodes",
            0,
            "commits",
            "nodes",
            0,
            "commit",
            "statusCheckRollup",
            "contexts",
            "nodes",
            0,
          ],
          message: "Resource not accessible by personal access token",
        },
      ],
    }));

    const { snapshots } = await fetchPrDetails(octokit, ["PR_1"]);
    expect(snapshots[0]?.checks).toEqual({
      state: "FAILURE",
      failing: [{ name: "Vercel", url: null }],
    });
  });

  it("throws when anything other than a check run is forbidden", async () => {
    const { octokit } = fakeGraphQL(() => ({
      data: { nodes: [githubPr()] },
      errors: [
        {
          type: "FORBIDDEN",
          path: ["nodes", 0, "commits", "nodes", 0],
          message: "Resource not accessible by personal access token",
        },
      ],
    }));
    await expect(fetchPrDetails(octokit, ["PR_1"])).rejects.toThrow(
      "Resource not accessible",
    );
  });

  it("throws other GitHub errors", async () => {
    const { octokit } = fakeGraphQL(() => ({
      data: null,
      errors: [{ type: "RATE_LIMITED", message: "Slow down" }],
    }));
    await expect(fetchPrDetails(octokit, ["PR_1"])).rejects.toThrow(
      "Slow down",
    );
  });
});

describe("mentionsIn", () => {
  it("finds each mentioned login once, in lowercase", () => {
    expect(mentionsIn("@Sam and @jlee-2, thanks @sam.")).toEqual([
      "sam",
      "jlee-2",
    ]);
  });

  it("skips emails and team mentions", () => {
    expect(mentionsIn("mail me@example.com or ping @acme/frontend")).toEqual(
      [],
    );
  });
});

describe("preview", () => {
  it("puts text on one line and cuts it at 200 characters", () => {
    expect(preview("  one\n\ntwo\tthree  ")).toBe("one two three");
    expect(preview("b".repeat(250))).toHaveLength(200);
  });
});
