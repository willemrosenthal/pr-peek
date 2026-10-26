import type { PrReview, PrSnapshot } from "@pr-peek/core";
import { describe, expect, it } from "vitest";
import { reviewersOf } from "./reviewers";

// The signed in user.
const VIEWER = "octocat";

const at = (minute: number) =>
  `2026-10-21T12:${String(minute).padStart(2, "0")}:00Z`;

let reviewCount = 0;
const review = (
  login: string,
  state: PrReview["state"],
  minute: number,
  isBot = false,
): PrReview => ({
  id: `R_${(reviewCount += 1)}`,
  author: { login, isBot },
  state,
  submittedAt: at(minute),
});

const snapshot = (fields: Partial<PrSnapshot>): PrSnapshot => ({
  id: "PR_7",
  number: 7,
  repo: { owner: "acme", name: "web-app" },
  title: "Add login",
  url: "https://github.com/acme/web-app/pull/7",
  author: { login: "sam", isBot: false },
  isDraft: false,
  headSha: "abc123",
  headCommittedAt: at(0),
  updatedAt: at(0),
  reviewRequests: [],
  reviewRequestEvents: [],
  reviews: [],
  threads: [],
  comments: [],
  checks: { state: null, failing: [] },
  ...fields,
});

const statuses = (pr: PrSnapshot) =>
  reviewersOf(pr, VIEWER).map((r) => `${r.name}:${r.status}`);

describe("reviewersOf", () => {
  it("lists those still asked first, then everyone who reviewed by latest review", () => {
    const pr = snapshot({
      reviewRequests: [
        { type: "user", login: "jordan" },
        { type: "team", slug: "acme/web" },
      ],
      reviews: [
        review("jules", "APPROVED", 5),
        review("dev", "CHANGES_REQUESTED", 2),
      ],
    });
    expect(statuses(pr)).toEqual([
      "jordan:requested",
      "acme/web:requested",
      "dev:changes_requested",
      "jules:approved",
    ]);
    expect(reviewersOf(pr, VIEWER)[1]?.isTeam).toBe(true);
  });

  it("keeps a verdict over later comments, and clears it when dismissed", () => {
    const pr = snapshot({
      reviews: [
        review("jules", "APPROVED", 1),
        review("jules", "COMMENTED", 3),
        review("dev", "APPROVED", 2),
        review("dev", "DISMISSED", 4),
        review("lee", "COMMENTED", 5),
      ],
    });
    expect(statuses(pr)).toEqual([
      "jules:approved",
      "dev:commented",
      "lee:commented",
    ]);
  });

  it("shows someone asked again after reviewing as waiting, once", () => {
    const pr = snapshot({
      reviewRequests: [{ type: "user", login: "Jules" }],
      reviews: [review("jules", "CHANGES_REQUESTED", 1)],
    });
    expect(statuses(pr)).toEqual(["Jules:requested"]);
  });

  it("marks the signed in user, asked or reviewed, whatever the case", () => {
    const youIn = (pr: PrSnapshot) =>
      reviewersOf(pr, VIEWER).map((r) => r.isYou);
    expect(
      youIn(
        snapshot({
          reviewRequests: [
            { type: "user", login: "OctoCat" },
            { type: "team", slug: "acme/octocat" },
          ],
        }),
      ),
    ).toEqual([true, false]);
    expect(
      youIn(snapshot({ reviews: [review("octocat", "APPROVED", 1)] })),
    ).toEqual([true]);
  });

  it("leaves out bots, like Copilot's AI reviewer", () => {
    const pr = snapshot({
      reviews: [
        review("copilot-pull-request-reviewer", "COMMENTED", 1, true),
        review("jules", "APPROVED", 2),
      ],
    });
    expect(statuses(pr)).toEqual(["jules:approved"]);
  });

  it("leaves out the author's own reviews", () => {
    const pr = snapshot({ reviews: [review("Sam", "COMMENTED", 1)] });
    expect(reviewersOf(pr, VIEWER)).toEqual([]);
  });
});
