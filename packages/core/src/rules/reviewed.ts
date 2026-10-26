import type { PrReview } from "../pr-snapshot";
import {
  andMore,
  isAfter,
  isOther,
  isViewer,
  lastPushOf,
  latestBy,
  viewerLastActivity,
} from "./helpers";
import type { Rule } from "./types";

// Approvals and change requests on your PR. Each reviewer's latest one counts.
// Approvals stay until the PR closes. Change requests clear when you push or reply.
export const reviewed: Rule = {
  id: "reviewed",
  name: "My PR was reviewed",
  group: "My PRs",
  defaultSeverity: "normal",
  defaultChannels: ["list", "push"],
  detect(snapshot, ctx) {
    if (!isViewer(snapshot.author, ctx)) return [];

    const byReviewer = new Map<string, PrReview>();
    for (const review of snapshot.reviews) {
      if (!isOther(review.author, ctx)) continue;
      if (review.state !== "APPROVED" && review.state !== "CHANGES_REQUESTED") {
        continue;
      }
      const key = review.author.login.toLowerCase();
      const previous = byReviewer.get(key);
      if (!previous || isAfter(review.submittedAt, previous.submittedAt)) {
        byReviewer.set(key, review);
      }
    }

    const since = viewerLastActivity(snapshot, ctx);
    const pushedAt = lastPushOf(snapshot).committedAt;
    const open = [...byReviewer.values()].filter(
      (review) =>
        review.state === "APPROVED" ||
        (isAfter(review.submittedAt, pushedAt) &&
          isAfter(review.submittedAt, since)),
    );
    const latest = latestBy(open, (review) => review.submittedAt);
    if (!latest) return [];

    const verb = latest.state === "APPROVED" ? "approved" : "requested changes";
    return [
      {
        kind: "reviewed",
        dedupeKey: `reviewed:${snapshot.id}`,
        latestEventId: latest.id,
        eventCount: open.length,
        actorLogin: latest.author.login,
        actorIsBot: latest.author.isBot,
        summary: `${latest.author.login} ${verb}${andMore(open.length)}`,
        occurredAt: latest.submittedAt,
        waitingSince: null,
        waitingOnAuthor: false,
      },
    ];
  },
};
