import { describe, expect, it } from "vitest";
import type { PrSnapshot } from "../pr-snapshot";
import { checkFailed } from "./check-failed";
import { actor, at, ctx, snapshot, VIEWER } from "./test-helpers";

const myPr = (checks: PrSnapshot["checks"]) =>
  snapshot({ author: actor(VIEWER), checks });

const detect = (pr: PrSnapshot) => checkFailed.detect(pr, ctx());

const failing = [
  { name: "e2e-tests", url: "https://ci.example/1" },
  { name: "lint", url: null },
];

describe("check failed on my PR", () => {
  it("makes an item listing the failing checks", () => {
    expect(detect(myPr({ state: "FAILURE", failing }))).toEqual([
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
    expect(detect(myPr({ state: "ERROR", failing }))).toHaveLength(1);
  });

  it("still makes an item when no failing check is named", () => {
    expect(detect(myPr({ state: "FAILURE", failing: [] }))[0]).toMatchObject({
      eventCount: 1,
      summary: "Checks failed",
    });
  });

  it.each(["SUCCESS", "PENDING", null] as const)(
    "makes no item when checks are %s",
    (state) => {
      expect(detect(myPr({ state, failing: [] }))).toEqual([]);
    },
  );

  it("makes a new item for a new commit", () => {
    const pr = { ...myPr({ state: "FAILURE", failing }), headSha: "def456" };
    expect(detect(pr)[0]?.dedupeKey).toBe("check:PR_1:def456");
  });

  it("ignores other people's PRs", () => {
    const pr = snapshot({ checks: { state: "FAILURE", failing } });
    expect(detect(pr)).toEqual([]);
  });
});
