import { describe, expect, it } from "vitest";
import { assignedState } from "./assigned-state";
import type { PrSnapshot } from "./pr-snapshot";
import { snapshot } from "./rules/test-helpers";

const checks = (state: PrSnapshot["checks"]["state"]) => ({
  checks: { state, failing: [] },
});

describe("assignedState", () => {
  it("picks the first state that matches", () => {
    const everything = {
      isDraft: true,
      mergeable: "CONFLICTING",
      reviewDecision: "CHANGES_REQUESTED",
      ...checks("FAILURE"),
    } as const;
    expect(assignedState(snapshot(everything))).toBe("draft");
    expect(assignedState(snapshot({ ...everything, isDraft: false }))).toBe(
      "conflicts",
    );
    expect(
      assignedState(
        snapshot({ ...everything, isDraft: false, mergeable: "MERGEABLE" }),
      ),
    ).toBe("checks_failing");
    expect(
      assignedState(snapshot({ reviewDecision: "CHANGES_REQUESTED" })),
    ).toBe("changes_requested");
  });

  it("counts errors as failing checks", () => {
    expect(assignedState(snapshot(checks("ERROR")))).toBe("checks_failing");
  });

  it("is ready to merge once approved and checks pass, or there are none", () => {
    expect(assignedState(snapshot({ reviewDecision: "APPROVED" }))).toBe(
      "ready_to_merge",
    );
    expect(
      assignedState(snapshot({ reviewDecision: "APPROVED", ...checks(null) })),
    ).toBe("ready_to_merge");
  });

  it("waits for running checks, even when approved", () => {
    for (const state of ["PENDING", "EXPECTED"] as const) {
      expect(
        assignedState(
          snapshot({ reviewDecision: "APPROVED", ...checks(state) }),
        ),
      ).toBe("checks_running");
    }
  });

  it("waits on review otherwise", () => {
    expect(assignedState(snapshot())).toBe("waiting_on_review");
    expect(assignedState(snapshot({ reviewDecision: "REVIEW_REQUIRED" }))).toBe(
      "waiting_on_review",
    );
  });

  it("isn't blocked by a merge state GitHub hasn't worked out yet", () => {
    expect(
      assignedState(
        snapshot({ reviewDecision: "APPROVED", mergeable: "UNKNOWN" }),
      ),
    ).toBe("ready_to_merge");
  });
});
