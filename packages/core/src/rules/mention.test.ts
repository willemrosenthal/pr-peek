import { describe, expect, it } from "vitest";
import type { PrSnapshot } from "../pr-snapshot";
import { mention } from "./mention";
import { reply } from "./reply";
import {
  actor,
  at,
  comment,
  ctx,
  myPr,
  review,
  snapshot,
  thread,
  VIEWER,
} from "./test-helpers";

const detect = (pr: PrSnapshot, context = ctx()) => mention.detect(pr, context);

const mentioning = (id: string, author: string, minutes: number) =>
  comment(id, author, minutes, {
    bodyPreview: `@${VIEWER} can you look?`,
    mentions: [VIEWER],
  });

describe("mentioned me", () => {
  it("makes an item for a comment that mentions you, on a PR you never touched", () => {
    const pr = snapshot({ comments: [mentioning("C_1", "sam", 10)] });
    expect(detect(pr)).toEqual([
      {
        kind: "mention",
        dedupeKey: "mention:PR_1",
        latestEventId: "C_1",
        eventCount: 1,
        actorLogin: "sam",
        actorIsBot: false,
        summary: 'sam: "@me can you look?"',
        occurredAt: at(10),
        waitingSince: null,
        waitingOnAuthor: false,
      },
    ]);
  });

  it("finds mentions in the description", () => {
    const pr = snapshot({ description: mentioning("body:PR_1", "sam", 0) });
    expect(detect(pr)[0]).toMatchObject({ latestEventId: "body:PR_1" });
  });

  it("finds mentions in a review's summary", () => {
    const pr = snapshot({
      reviews: [
        {
          ...review("R_1", "jlee", 10, "CHANGES_REQUESTED"),
          bodyPreview: "@me thoughts?",
          mentions: [VIEWER],
        },
      ],
    });
    expect(detect(pr)[0]).toMatchObject({
      latestEventId: "R_1",
      summary: 'jlee: "@me thoughts?"',
      occurredAt: at(10),
    });
  });

  it("finds mentions in review threads you're not in", () => {
    const pr = snapshot({ threads: [thread([mentioning("C_1", "jlee", 10)])] });
    expect(detect(pr)[0]).toMatchObject({ latestEventId: "C_1" });
  });

  it("leaves a mention in your own thread to the reply rule, so it's one item", () => {
    const pr = snapshot({
      threads: [
        thread([comment("C_1", VIEWER, 5), mentioning("C_2", "sam", 10)]),
      ],
    });
    expect(detect(pr)).toEqual([]);
    expect(reply.detect(pr, ctx())).toHaveLength(1);
  });

  it("counts every mention and shows the latest", () => {
    const pr = snapshot({
      comments: [
        mentioning("C_1", "sam", 10),
        comment("C_2", "jlee", 15),
        mentioning("C_3", "jlee", 20),
      ],
    });
    expect(detect(pr)[0]).toMatchObject({
      latestEventId: "C_3",
      eventCount: 2,
    });
  });

  it("clears when you comment or review after the mention", () => {
    const comments = [mentioning("C_1", "sam", 10)];
    expect(
      detect(snapshot({ comments: [...comments, comment("C_2", VIEWER, 20)] })),
    ).toEqual([]);
    expect(
      detect(snapshot({ comments, reviews: [review("R_1", VIEWER, 20)] })),
    ).toEqual([]);
  });

  it("only counts mentions after your latest comment", () => {
    const pr = snapshot({
      comments: [
        mentioning("C_1", "sam", 10),
        comment("C_2", VIEWER, 20),
        mentioning("C_3", "jlee", 30),
      ],
    });
    expect(detect(pr)[0]).toMatchObject({
      latestEventId: "C_3",
      eventCount: 1,
    });
  });

  it("ignores comments that don't mention you", () => {
    const pr = snapshot({
      comments: [comment("C_1", "sam", 10, { mentions: ["jlee"] })],
    });
    expect(detect(pr)).toEqual([]);
  });

  it("ignores resolved threads", () => {
    const pr = snapshot({
      threads: [thread([mentioning("C_1", "jlee", 10)], true)],
    });
    expect(detect(pr)).toEqual([]);
  });

  it("ignores bots when they're hidden", () => {
    const bot = comment("C_1", actor("ci-bot", true), 10, {
      mentions: [VIEWER],
    });
    const pr = snapshot({ comments: [bot] });
    expect(detect(pr)).toHaveLength(1);
    expect(detect(pr, ctx({ settings: { hideBots: true } }))).toEqual([]);
  });

  it("leaves your own PR to the comment rule", () => {
    const pr = myPr({ comments: [mentioning("C_1", "sam", 10)] });
    expect(detect(pr)).toEqual([]);
  });
});
