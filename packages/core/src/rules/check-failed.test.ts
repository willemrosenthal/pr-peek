import { describe, expect, it } from "vitest";
import type { PrSnapshot } from "../pr-snapshot";
import { checkFailed } from "./check-failed";
import { at, branchUpdate, ctx, myPr, snapshot } from "./test-helpers";

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
        actorIsBot: false,
        summary: "e2e-tests, lint",
        occurredAt: at(0),
        waitingSince: null,
        waitingOnAuthor: false,
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

  describe("after Update branch", () => {
    const updated = (checks: PrSnapshot["checks"], pushChecksFailed = true) =>
      myPr({ ...branchUpdate(20, pushChecksFailed), checks });

    it.each(["PENDING", null] as const)(
      "keeps the push's failure while checks are %s",
      (state) => {
        expect(detect(updated({ state, failing: [] }))).toEqual([
          {
            kind: "check_failed",
            dedupeKey: "check:PR_1:abc123",
            latestEventId: "abc123",
            eventCount: 1,
            actorLogin: null,
            actorIsBot: false,
            summary: "Checks failed before the branch update",
            occurredAt: at(0),
            waitingSince: null,
            waitingOnAuthor: false,
          },
        ]);
      },
    );

    it("is the same item when checks fail again", () => {
      expect(detect(updated({ state: "FAILURE", failing }))[0]).toMatchObject({
        dedupeKey: "check:PR_1:abc123",
        latestEventId: "abc123",
        summary: "e2e-tests, lint",
      });
    });

    it("clears once checks pass", () => {
      expect(detect(updated({ state: "SUCCESS", failing: [] }))).toEqual([]);
    });

    it("makes no item when the push's checks didn't fail, like a cancelled run", () => {
      const pr = updated({ state: "PENDING", failing: [] }, false);
      expect(detect(pr)).toEqual([]);
    });
  });

  it("ignores other people's PRs", () => {
    const pr = snapshot({ checks: { state: "FAILURE", failing } });
    expect(detect(pr)).toEqual([]);
  });
});
