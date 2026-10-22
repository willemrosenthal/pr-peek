import { describe, expect, it } from "vitest";
import type { PrSnapshot } from "../pr-snapshot";
import { reply } from "./reply";
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

const detect = (pr: PrSnapshot, context = ctx()) => reply.detect(pr, context);

describe("reply to my comment", () => {
  it("makes an item for a reply in a thread you commented in", () => {
    const pr = snapshot({
      threads: [
        thread([
          comment("C_1", VIEWER, 5),
          comment("C_2", "sam", 10, {
            bodyPreview: "Good call, moved it",
            replyToId: "C_1",
          }),
        ]),
      ],
    });
    expect(detect(pr)).toEqual([
      {
        kind: "reply",
        dedupeKey: "reply:PR_1",
        latestEventId: "C_2",
        eventCount: 1,
        actorLogin: "sam",
        actorIsBot: false,
        summary: 'sam: "Good call, moved it"',
        occurredAt: at(10),
        waitingSince: null,
      },
    ]);
  });

  it("counts every reply and shows the latest", () => {
    const pr = snapshot({
      threads: [
        thread([
          comment("C_1", VIEWER, 5),
          comment("C_2", "sam", 10),
          comment("C_3", "jlee", 15),
        ]),
      ],
    });
    expect(detect(pr)[0]).toMatchObject({
      latestEventId: "C_3",
      eventCount: 2,
      summary: 'jlee: "Comment C_3" (+1 more)',
    });
  });

  it("ignores threads you're not in", () => {
    const pr = snapshot({
      comments: [comment("C_0", VIEWER, 1)],
      threads: [thread([comment("C_1", "jlee", 5), comment("C_2", "sam", 10)])],
    });
    expect(detect(pr)).toEqual([]);
  });

  it("leaves conversation mentions to the mention rule", () => {
    const pr = snapshot({
      comments: [
        comment("C_1", VIEWER, 5),
        comment("C_2", "sam", 10, { mentions: ["me"] }),
      ],
    });
    expect(detect(pr)).toEqual([]);
  });

  it("clears when you comment on the PR after the reply", () => {
    const pr = snapshot({
      threads: [thread([comment("C_1", VIEWER, 5), comment("C_2", "sam", 10)])],
      comments: [comment("C_3", VIEWER, 20)],
    });
    expect(detect(pr)).toEqual([]);
  });

  it("ignores resolved threads", () => {
    const pr = snapshot({
      threads: [
        thread([comment("C_1", VIEWER, 5), comment("C_2", "sam", 10)], true),
      ],
    });
    expect(detect(pr)).toEqual([]);
  });

  it("ignores bots when they're hidden", () => {
    const pr = snapshot({
      threads: [
        thread([
          comment("C_1", VIEWER, 5),
          comment("C_2", actor("ci-bot", true), 10),
        ]),
      ],
    });
    expect(detect(pr)).toHaveLength(1);
    expect(detect(pr, ctx({ settings: { hideBots: true } }))).toEqual([]);
  });

  it("leaves your own PR to the comment rule", () => {
    const pr = myPr({
      threads: [thread([comment("C_1", VIEWER, 5), comment("C_2", "sam", 10)])],
    });
    expect(detect(pr)).toEqual([]);
  });
});
