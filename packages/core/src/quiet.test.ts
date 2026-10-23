import { describe, expect, it } from "vitest";
import { wakesOnPush } from "./quiet";
import { branchUpdate, myPr, snapshot, VIEWER } from "./rules/test-helpers";

describe("wakesOnPush", () => {
  it("wakes the viewer's PR when they push new commits", () => {
    expect(wakesOnPush(myPr(), myPr({ headSha: "def456" }), VIEWER)).toBe(true);
  });

  it("ignores login case", () => {
    expect(wakesOnPush(myPr(), myPr({ headSha: "def456" }), "ME")).toBe(true);
  });

  it("doesn't wake other people's PRs on new commits", () => {
    expect(
      wakesOnPush(snapshot(), snapshot({ headSha: "def456" }), VIEWER),
    ).toBe(false);
  });

  it("doesn't wake on Update branch", () => {
    expect(wakesOnPush(myPr(), myPr(branchUpdate(30)), VIEWER)).toBe(false);
  });

  it("doesn't wake when the commits are the same", () => {
    expect(wakesOnPush(myPr(), myPr({ title: "New title" }), VIEWER)).toBe(
      false,
    );
  });
});
