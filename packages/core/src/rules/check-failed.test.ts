import { describe, expect, it } from "vitest";
import type { PrSnapshot } from "../pr-snapshot";
import { checkFailed } from "./check-failed";
import { at, ctx, myPr, snapshot } from "./test-helpers";

const withChecks = (checks: PrSnapshot["checks"]) => myPr({ checks });

const detect = (pr: PrSnapshot) => checkFailed.detect(pr, ctx());

const failing = [
  { name: "e2e-tests", url: "https://ci.example/1" },
  { name: "lint", url: null },
];

describe("check failed on my PR", () => {
  it("makes an item listing the failing checks", () => {
    expect(detect(withChecks({ state: "FAILURE", failing }))).toEqual([
      {
        kind: "check_failed",
        dedupeKey: "check:PR_1:abc123",
        latestEventId: "abc123",
        eventCount: 2,
        actorLogin: null,
        summary: "e2e-tests, lint",
        occurredAt: at(0),
        waitingSince: null,
      },
    ]);
  });

  it("counts errors as failures", () => {
    expect(detect(withChecks({ state: "ERROR", failing }))).toHaveLength(1);
  });

  it("still makes an item when no failing check is named", () => {
    const pr = withChecks({ state: "FAILURE", failing: [] });
    expect(detect(pr)[0]).toMatchObject({
      eventCount: 1,
      summary: "Checks failed",
    });
  });

  it.each(["SUCCESS", "PENDING", null] as const)(
    "makes no item when checks are %s",
    (state) => {
      expect(detect(withChecks({ state, failing: [] }))).toEqual([]);
    },
  );

  it("makes a new item for a new commit", () => {
    const pr = {
      ...withChecks({ state: "FAILURE", failing }),
      headSha: "def456",
    };
    expect(detect(pr)[0]?.dedupeKey).toBe("check:PR_1:def456");
  });

  it("ignores other people's PRs", () => {
    const pr = snapshot({ checks: { state: "FAILURE", failing } });
    expect(detect(pr)).toEqual([]);
  });
});
