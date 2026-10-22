import { describe, expect, it } from "vitest";
import type { PrSnapshot } from "../pr-snapshot";
import { commented } from "./commented";
import {
  actor,
  at,
  branchUpdate,
  comment,
  ctx,
  myPr,
  review,
  snapshot,
  thread,
  VIEWER,
} from "./test-helpers";

const detect = (pr: PrSnapshot, context = ctx()) =>
  commented.detect(pr, context);

describe("new comment on my PR", () => {
  it("makes one item for conversation and thread comments", () => {
    const pr = myPr({
      comments: [comment("C_1", "sam", 10)],
      threads: [thread([comment("C_2", "jlee", 20)])],
    });
    expect(detect(pr)).toEqual([
      {
        kind: "commented",
        dedupeKey: "commented:PR_1",
        latestEventId: "C_2",
        eventCount: 2,
        actorLogin: "jlee",
        actorIsBot: false,
        summary: 'jlee: "Comment C_2" (+1 more)',
        occurredAt: at(20),
        waitingSince: null,
      },
    ]);
  });

  it("ignores your own comments", () => {
    const pr = myPr({ comments: [comment("C_1", VIEWER, 10)] });
    expect(detect(pr)).toEqual([]);
  });

  it("marks a bot's comment, and ignores bots when they're hidden", () => {
    const pr = myPr({ comments: [comment("C_1", actor("ci-bot", true), 10)] });
    expect(detect(pr)).toMatchObject([{ actorIsBot: true }]);
    expect(detect(pr, ctx({ settings: { hideBots: true } }))).toEqual([]);
  });

  it("only counts comments after your latest reply", () => {
    const pr = myPr({
      comments: [
        comment("C_1", "sam", 10),
        comment("C_2", VIEWER, 20),
        comment("C_3", "sam", 30),
      ],
    });
    expect(detect(pr)[0]).toMatchObject({
      latestEventId: "C_3",
      eventCount: 1,
    });
  });

  it("clears when you push a new commit", () => {
    const pr = myPr({
      headCommittedAt: at(20),
      comments: [comment("C_1", "sam", 10)],
    });
    expect(detect(pr)).toEqual([]);
  });

  it("counts a Comment review's summary", () => {
    const pr = myPr({
      reviews: [
        { ...review("R_1", "jlee", 10, "COMMENTED"), bodyPreview: "Nice work" },
      ],
    });
    expect(detect(pr)[0]).toMatchObject({
      latestEventId: "R_1",
      summary: 'jlee: "Nice work"',
    });
  });

  it("skips empty Comment reviews, and leaves approvals to the reviewed rule", () => {
    const pr = myPr({
      reviews: [
        review("R_1", "jlee", 10, "COMMENTED"),
        { ...review("R_2", "sam", 10, "APPROVED"), bodyPreview: "Ship it" },
      ],
    });
    expect(detect(pr)).toEqual([]);
  });

  it("stays after Update branch", () => {
    const pr = myPr({
      ...branchUpdate(20),
      comments: [comment("C_1", "sam", 10)],
    });
    expect(detect(pr)).toHaveLength(1);
  });

  it("ignores resolved threads", () => {
    const pr = myPr({
      threads: [thread([comment("C_1", "sam", 10)], true)],
    });
    expect(detect(pr)).toEqual([]);
  });

  it("ignores other people's PRs", () => {
    const pr = snapshot({ comments: [comment("C_1", "jlee", 10)] });
    expect(detect(pr)).toEqual([]);
  });
});
