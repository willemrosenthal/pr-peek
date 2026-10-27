import { describe, expect, it } from "vitest";
import type { PrAssignEvent, PrSnapshot } from "../pr-snapshot";
import { assigned } from "./assigned";
import { actor, at, ctx, myPr, snapshot, VIEWER } from "./test-helpers";
import type { RuleContext } from "./types";

const assign = (
  id: string,
  minutes: number,
  by: string | ReturnType<typeof actor> = "sam",
  assignee = VIEWER,
  action: PrAssignEvent["action"] = "assigned",
): PrAssignEvent => ({
  id,
  action,
  assignee,
  actor: typeof by === "string" ? actor(by) : by,
  createdAt: at(minutes),
});

const detect = (pr: PrSnapshot, context: RuleContext = ctx()) =>
  assigned.detect(pr, context);

describe("assigned to me", () => {
  it("makes an item for who assigned you, and when", () => {
    const pr = snapshot({
      assignees: [VIEWER],
      assignEvents: [assign("AE_1", 5, "alice")],
    });
    expect(detect(pr)).toEqual([
      {
        kind: "assigned",
        dedupeKey: "as:PR_1:AE_1",
        latestEventId: "AE_1",
        eventCount: 1,
        actorLogin: "alice",
        actorIsBot: false,
        summary: "alice assigned you",
        occurredAt: at(5),
        waitingSince: at(5),
        waitingOnAuthor: false,
        startsSeen: false,
      },
    ]);
  });

  it("names the other assignees", () => {
    const one = snapshot({
      assignees: ["bob", VIEWER],
      assignEvents: [assign("AE_1", 5, "alice")],
    });
    expect(detect(one)[0]?.summary).toBe("alice assigned you, with bob");
    const two = snapshot({
      assignees: ["bob", "Me", "cara"],
      assignEvents: [assign("AE_1", 5, "alice")],
    });
    expect(detect(two)[0]?.summary).toBe(
      "alice assigned you, with bob (+1 more)",
    );
  });

  it("skips PRs you aren't assigned to", () => {
    // Also a snapshot stored before assignees were saved.
    expect(detect(snapshot())).toEqual([]);
    expect(detect(snapshot({ assignees: ["bob"] }))).toEqual([]);
  });

  it("skips your own PRs, since they're under My PRs", () => {
    expect(detect(myPr({ assignees: [VIEWER] }))).toEqual([]);
  });

  it("uses the latest assignment, so being assigned again is a new item", () => {
    const pr = snapshot({
      assignees: [VIEWER],
      assignEvents: [
        assign("AE_1", 5),
        assign("UE_1", 10, "sam", VIEWER, "unassigned"),
        assign("AE_2", 20),
        // Someone else's.
        assign("AE_3", 30, "sam", "bob"),
      ],
    });
    expect(detect(pr)[0]).toMatchObject({
      dedupeKey: "as:PR_1:AE_2",
      waitingSince: at(20),
    });
  });

  it("still makes an item when the assignment is older than the timeline", () => {
    expect(detect(snapshot({ assignees: [VIEWER] }))[0]).toMatchObject({
      dedupeKey: "as:PR_1:current",
      actorLogin: null,
      summary: "Assigned to you",
      occurredAt: at(0),
      waitingSince: null,
      startsSeen: false,
    });
  });

  it("starts seen when you assigned yourself", () => {
    const pr = snapshot({
      assignees: [VIEWER],
      assignEvents: [assign("AE_1", 5, VIEWER)],
    });
    expect(detect(pr)[0]).toMatchObject({
      actorLogin: null,
      summary: "You assigned yourself",
      startsSeen: true,
    });
  });

  it("starts seen when a bot assigned you, only if bots are hidden", () => {
    const pr = snapshot({
      assignees: [VIEWER],
      assignEvents: [assign("AE_1", 5, actor("round-robin", true))],
    });
    expect(detect(pr)[0]).toMatchObject({
      actorIsBot: true,
      startsSeen: false,
    });
    expect(
      detect(pr, ctx({ settings: { hideBots: true } }))[0]?.startsSeen,
    ).toBe(true);
  });
});
