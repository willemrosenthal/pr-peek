import { describe, expect, it } from "vitest";
import { lastPushSha, wakesOnPush } from "./quiet";
import { branchUpdate, myPr, snapshot, VIEWER } from "./rules/test-helpers";

describe("wakesOnPush", () => {
  it("wakes the viewer's PR when they push new commits", () => {
    expect(
      wakesOnPush(lastPushSha(myPr()), myPr({ headSha: "def456" }), VIEWER),
    ).toBe(true);
  });

  it("ignores login case", () => {
    expect(
      wakesOnPush(lastPushSha(myPr()), myPr({ headSha: "def456" }), "ME"),
    ).toBe(true);
  });

  it("doesn't wake other people's PRs on new commits", () => {
    expect(
      wakesOnPush(
        lastPushSha(snapshot()),
        snapshot({ headSha: "def456" }),
        VIEWER,
      ),
    ).toBe(false);
  });

  it("doesn't wake on Update branch", () => {
    expect(
      wakesOnPush(lastPushSha(myPr()), myPr(branchUpdate(30)), VIEWER),
    ).toBe(false);
  });

  it("doesn't wake before the last push is known", () => {
    expect(wakesOnPush(null, myPr({ headSha: "def456" }), VIEWER)).toBe(false);
  });

  it("doesn't wake when the commits are the same", () => {
    expect(
      wakesOnPush(lastPushSha(myPr()), myPr({ title: "New title" }), VIEWER),
    ).toBe(false);
  });
});
