import { describe, expect, it } from "vitest";
import type { PrSnapshot } from "../pr-snapshot";
import { reviewed } from "./reviewed";
import {
  actor,
  at,
  comment,
  ctx,
  myPr,
  review,
  snapshot,
  VIEWER,
} from "./test-helpers";

const detect = (pr: PrSnapshot, context = ctx()) =>
  reviewed.detect(pr, context);

describe("my PR was reviewed", () => {
  it("makes an item for an approval", () => {
    const pr = myPr({ reviews: [review("R_1", "jlee", 10, "APPROVED")] });
    expect(detect(pr)).toEqual([
      {
        kind: "reviewed",
        dedupeKey: "reviewed:PR_1",
        latestEventId: "R_1",
        eventCount: 1,
        actorLogin: "jlee",
        summary: "jlee approved",
        occurredAt: at(10),
        waitingSince: null,
      },
    ]);
  });

  it("makes an item for a change request", () => {
    const pr = myPr({
      reviews: [review("R_1", "jlee", 10, "CHANGES_REQUESTED")],
    });
    expect(detect(pr)[0]?.summary).toBe("jlee requested changes");
  });

  it("shows the latest of several reviewers", () => {
    const pr = myPr({
      reviews: [
        review("R_1", "jlee", 10, "APPROVED"),
        review("R_2", "sam", 20, "CHANGES_REQUESTED"),
      ],
    });
    expect(detect(pr)[0]).toMatchObject({
      latestEventId: "R_2",
      eventCount: 2,
      summary: "sam requested changes (+1 more)",
    });
  });

  it("uses each reviewer's latest decision", () => {
    const pr = myPr({
      reviews: [
        review("R_1", "jlee", 10, "CHANGES_REQUESTED"),
        review("R_2", "jlee", 20, "APPROVED"),
        review("R_3", "jlee", 30, "COMMENTED"),
      ],
    });
    expect(detect(pr)[0]).toMatchObject({
      latestEventId: "R_2",
      eventCount: 1,
      summary: "jlee approved",
    });
  });

  it("ignores comment-only and dismissed reviews", () => {
    const pr = myPr({
      reviews: [
        review("R_1", "jlee", 10, "COMMENTED"),
        review("R_2", "sam", 10, "DISMISSED"),
      ],
    });
    expect(detect(pr)).toEqual([]);
  });

  it("clears a change request when you push a new commit", () => {
    const pr = myPr({
      headCommittedAt: at(20),
      reviews: [review("R_1", "jlee", 10, "CHANGES_REQUESTED")],
    });
    expect(detect(pr)).toEqual([]);
  });

  it("clears a change request when you reply", () => {
    const pr = myPr({
      reviews: [review("R_1", "jlee", 10, "CHANGES_REQUESTED")],
      comments: [comment("C_1", VIEWER, 20)],
    });
    expect(detect(pr)).toEqual([]);
  });

  it("keeps an approval after you push or reply", () => {
    const pr = myPr({
      headCommittedAt: at(20),
      reviews: [review("R_1", "jlee", 10, "APPROVED")],
      comments: [comment("C_1", VIEWER, 30)],
    });
    expect(detect(pr)).toHaveLength(1);
  });

  it("ignores bots when they're hidden", () => {
    const pr = myPr({
      reviews: [review("R_1", actor("ci-bot", true), 10, "APPROVED")],
    });
    expect(detect(pr)).toHaveLength(1);
    expect(detect(pr, ctx({ settings: { hideBots: true } }))).toEqual([]);
  });

  it("ignores other people's PRs", () => {
    const pr = snapshot({ reviews: [review("R_1", "jlee", 10, "APPROVED")] });
    expect(detect(pr)).toEqual([]);
  });
});
