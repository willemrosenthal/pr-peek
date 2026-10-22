import { describe, expect, it } from "vitest";
import type { PrSnapshot } from "../pr-snapshot";
import { commented } from "./commented";
import {
  actor,
  at,
  comment,
  ctx,
  myPr,
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

  it("ignores bots when they're hidden", () => {
    const pr = myPr({ comments: [comment("C_1", actor("ci-bot", true), 10)] });
    expect(detect(pr)).toHaveLength(1);
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
