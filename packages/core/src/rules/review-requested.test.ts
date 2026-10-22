import { describe, expect, it } from "vitest";
import type { PrSnapshot } from "../pr-snapshot";
import { reRequested, reviewRequested } from "./review-requested";
import {
  actor,
  at,
  ctx,
  requested,
  review,
  snapshot,
  VIEWER,
} from "./test-helpers";

const me = { type: "user", login: VIEWER } as const;
const team = { type: "team", slug: "acme/web" } as const;

// Both rules' items for a PR.
const detect = (pr: PrSnapshot, context = ctx()) => [
  ...reviewRequested.detect(pr, context),
  ...reRequested.detect(pr, context),
];

const askedAt = (minutes: number) =>
  snapshot({
    reviewRequests: [me],
    reviewRequestEvents: [requested("RR_1", minutes)],
  });

describe("review requested", () => {
  it("makes an item when you're asked to review", () => {
    expect(detect(askedAt(5))).toEqual([
      {
        kind: "review_requested",
        dedupeKey: "rr:PR_1:RR_1",
        latestEventId: "RR_1",
        eventCount: 1,
        actorLogin: null,
        actorIsBot: false,
        summary: "Review requested",
        occurredAt: at(5),
        waitingSince: at(5),
      },
    ]);
  });

  it("uses the latest request event for you", () => {
    const pr = snapshot({
      reviewRequests: [me],
      reviewRequestEvents: [
        requested("RR_1", 5),
        requested("RR_other", 20, { type: "user", login: "jlee" }),
        requested("RR_2", 10),
      ],
    });
    expect(detect(pr)[0]).toMatchObject({
      dedupeKey: "rr:PR_1:RR_2",
      waitingSince: at(10),
    });
  });

  it("matches logins in any case", () => {
    const pr = askedAt(5);
    expect(detect(pr, ctx({ viewerLogin: "ME" }))).toHaveLength(1);
  });

  it("makes no item once you're no longer asked", () => {
    const pr = { ...askedAt(5), reviewRequests: [] };
    expect(detect(pr)).toEqual([]);
  });

  it("skips drafts unless you opt in", () => {
    const pr = { ...askedAt(5), isDraft: true };
    expect(detect(pr)).toEqual([]);
    expect(detect(pr, ctx({ settings: { includeDrafts: true } }))).toHaveLength(
      1,
    );
  });

  it("still works when the request event is too old to be fetched", () => {
    const pr = snapshot({ reviewRequests: [me], updatedAt: at(30) });
    expect(detect(pr)).toEqual([
      expect.objectContaining({
        dedupeKey: "rr:PR_1:current",
        occurredAt: at(30),
        waitingSince: null,
      }),
    ]);
  });

  describe("for your team", () => {
    const teamPr = snapshot({
      reviewRequests: [team],
      reviewRequestEvents: [requested("RR_1", 5, team)],
    });
    const onTeam = ctx({ viewerTeams: ["ACME/web"] });

    it("makes an item naming the team", () => {
      expect(detect(teamPr, onTeam)[0]).toMatchObject({
        kind: "review_requested",
        summary: "Review requested from acme/web",
        waitingSince: at(5),
      });
    });

    it("ignores teams you're not on", () => {
      expect(detect(teamPr, ctx({ viewerTeams: ["acme/api"] }))).toEqual([]);
    });

    it("ignores team requests when they're turned off", () => {
      const off = ctx({
        viewerTeams: ["acme/web"],
        settings: { includeTeamRequests: false },
      });
      expect(detect(teamPr, off)).toEqual([]);
    });

    it("clears when you review, even if the team request stays", () => {
      const pr = { ...teamPr, reviews: [review("R_1", VIEWER, 10)] };
      expect(detect(pr, onTeam)).toEqual([]);
    });
  });

  it("ignores your own PR", () => {
    const pr = { ...askedAt(5), author: actor(VIEWER) };
    expect(detect(pr)).toEqual([]);
  });
});

describe("review re-requested", () => {
  it("replaces the plain item when you're asked again after reviewing", () => {
    const pr = {
      ...askedAt(30),
      reviews: [review("R_1", VIEWER, 10, "CHANGES_REQUESTED")],
    };
    expect(detect(pr)).toEqual([
      expect.objectContaining({
        kind: "re_requested",
        dedupeKey: "rrr:PR_1:RR_1",
        summary: "Review requested again",
        waitingSince: at(30),
      }),
    ]);
  });

  it("clears when you review again", () => {
    const pr = {
      ...askedAt(30),
      reviews: [review("R_1", VIEWER, 10), review("R_2", VIEWER, 40)],
    };
    expect(detect(pr)).toEqual([]);
  });

  it("ignores reviews by other people", () => {
    const pr = { ...askedAt(30), reviews: [review("R_1", "jlee", 10)] };
    expect(detect(pr)[0]?.kind).toBe("review_requested");
  });
});
