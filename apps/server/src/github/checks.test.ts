import { describe, expect, it } from "vitest";
import { checkContexts } from "../../test/pulls";
import { countsFailed, failingChecks, rawChecks, readChecks } from "./checks";

const run = (
  name: string,
  conclusion: string | null,
  startedAt: string | null = "2026-11-05T02:00:00Z",
  workflow = "CI",
) => ({
  __typename: "CheckRun",
  name,
  conclusion,
  startedAt,
  detailsUrl: `https://ci.example/${name}`,
  checkSuite: {
    app: { slug: "github-actions" },
    workflowRun: { workflow: { name: workflow } },
  },
});

const status = (context: string, state: string, createdAt: string) => ({
  __typename: "StatusContext",
  context,
  state,
  createdAt,
  targetUrl: null,
});

// A commit's checks as the queries read them. `extra` replaces counts or paging.
const contexts = (nodes: unknown[], extra: object = {}) =>
  rawChecks.parse({ ...checkContexts(nodes), ...extra });

// GitHub's own state is FAILURE in most of these: it counts every run.
const read = (
  nodes: unknown[],
  githubState: "FAILURE" | "SUCCESS" = "FAILURE",
  extra: object = {},
) => readChecks({ state: githubState, contexts: contexts(nodes, extra) });

describe("readChecks", () => {
  it("passes when a run cancelled by a newer run of the same check passed", () => {
    // Editing a PR started its title check again, which stopped the first run.
    expect(
      read([
        run("pr-title", "CANCELLED", "2026-11-05T02:43:48Z"),
        run("pr-title", "SUCCESS", "2026-11-05T02:43:52Z"),
        run("test", "SUCCESS"),
      ]),
    ).toEqual({ state: "SUCCESS", githubState: "FAILURE", failing: [] });
  });

  it("passes when a failed check passed on a re-run", () => {
    expect(
      read([
        run("test", "SUCCESS", "2026-11-05T03:00:00Z"),
        run("test", "FAILURE", "2026-11-05T02:00:00Z"),
      ]).state,
    ).toBe("SUCCESS");
  });

  it("fails when the newest run failed, and lists it once", () => {
    expect(
      read([
        run("test", "SUCCESS", "2026-11-05T02:00:00Z"),
        run("test", "FAILURE", "2026-11-05T03:00:00Z"),
      ]),
    ).toMatchObject({
      state: "FAILURE",
      failing: [{ name: "test", url: "https://ci.example/test" }],
    });
  });

  it("keeps checks of the same name from different workflows apart", () => {
    expect(
      read([
        run("test", "FAILURE", "2026-11-05T02:00:00Z", "Web"),
        run("test", "SUCCESS", "2026-11-05T03:00:00Z", "Server"),
      ]),
    ).toMatchObject({ state: "FAILURE", failing: [{ name: "test" }] });
  });

  it("doesn't count a cancelled run as failed", () => {
    expect(read([run("test", "CANCELLED"), run("lint", "SUCCESS")]).state).toBe(
      "SUCCESS",
    );
  });

  it("is running while a check has no result, like a re-run waiting to start", () => {
    expect(read([run("test", "FAILURE"), run("test", null, null)]).state).toBe(
      "PENDING",
    );
  });

  it("reads statuses the same way, by their newest", () => {
    const nodes = [
      status("deploy", "FAILURE", "2026-11-05T02:00:00Z"),
      status("deploy", "SUCCESS", "2026-11-05T03:00:00Z"),
      status("preview", "PENDING", "2026-11-05T03:00:00Z"),
    ];
    expect(read(nodes).state).toBe("PENDING");
    expect(failingChecks(contexts(nodes))).toEqual([]);
  });

  it("is null without checks", () => {
    expect(readChecks(null)).toEqual({
      state: null,
      githubState: null,
      failing: [],
    });
    expect(read([], "SUCCESS").state).toBeNull();
  });

  describe("when some runs can't be seen", () => {
    const counts = (runs: Record<string, number>) => ({
      checkRunCountsByState: Object.entries(runs).map(([state, count]) => ({
        state,
        count,
      })),
      statusContextCountsByState: [],
    });

    it("goes by the counts, without cancelled runs, when runs are hidden", () => {
      const hidden = read(
        [null],
        "FAILURE",
        counts({ CANCELLED: 1, SUCCESS: 2 }),
      );
      expect(hidden.state).toBe("SUCCESS");
    });

    it("goes by the counts past 100 checks", () => {
      const many = read([run("test", "SUCCESS")], "FAILURE", {
        ...counts({ SUCCESS: 100, FAILURE: 1 }),
        pageInfo: { hasNextPage: true },
      });
      expect(many.state).toBe("FAILURE");
    });
  });
});

describe("countsFailed", () => {
  it("is true only for a failed run or status, not a cancelled one", () => {
    const counts = (state: string) => ({
      checkRunCountsByState: [{ state, count: 1 }],
      statusContextCountsByState: [],
    });
    expect(countsFailed(counts("TIMED_OUT"))).toBe(true);
    expect(countsFailed(counts("CANCELLED"))).toBe(false);
    expect(countsFailed(null)).toBe(false);
  });
});
