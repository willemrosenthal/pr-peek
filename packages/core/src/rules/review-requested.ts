import type {
  PrReviewer,
  PrReviewRequestEvent,
  PrSnapshot,
} from "../pr-snapshot";
import { isAfter, isViewer, latestBy, sameLogin } from "./helpers";
import type { DetectedItem, ItemKind, Rule, RuleContext } from "./types";

interface OpenRequest {
  // The latest request event for the viewer. Missing if it's older than the fetched timeline.
  event: PrReviewRequestEvent | undefined;
  // The viewer reviewed before this request, so it's a re-request.
  reviewedBefore: boolean;
}

// The viewer's review request on this PR, if they still owe a review.
function openRequest(
  snapshot: PrSnapshot,
  ctx: RuleContext,
): OpenRequest | null {
  if (isViewer(snapshot.author, ctx)) return null;
  if (snapshot.isDraft && !ctx.settings.includeDrafts) return null;

  const forViewer = (reviewer: PrReviewer) =>
    reviewer.type === "user"
      ? sameLogin(reviewer.login, ctx.viewerLogin)
      : ctx.settings.includeTeamRequests &&
        ctx.viewerTeams.some((team) => sameLogin(team, reviewer.slug));
  if (!snapshot.reviewRequests.some(forViewer)) return null;

  const event = latestBy(
    snapshot.reviewRequestEvents.filter(
      (e) => e.action === "requested" && forViewer(e.reviewer),
    ),
    (e) => e.createdAt,
  );
  const lastReview = latestBy(
    snapshot.reviews.filter((review) => isViewer(review.author, ctx)),
    (review) => review.submittedAt,
  );
  // Reviewed since the request. GitHub can leave a team request in place after a member
  // reviews. Without the event we can't tell the order, so assume the review came last.
  if (
    lastReview &&
    (!event || !isAfter(event.createdAt, lastReview.submittedAt))
  ) {
    return null;
  }
  return { event, reviewedBefore: Boolean(lastReview) };
}

function requestItem(
  kind: ItemKind,
  prefix: string,
  summary: string,
  snapshot: PrSnapshot,
  { event }: OpenRequest,
): DetectedItem {
  const eventId = event?.id ?? "current";
  const team = event?.reviewer.type === "team" ? event.reviewer.slug : null;
  return {
    kind,
    dedupeKey: `${prefix}:${snapshot.id}:${eventId}`,
    latestEventId: eventId,
    eventCount: 1,
    actorLogin: null,
    actorIsBot: false,
    summary: team ? `${summary} from ${team}` : summary,
    occurredAt: event?.createdAt ?? snapshot.updatedAt,
    waitingSince: event?.createdAt ?? null,
  };
}

export const reviewRequested: Rule = {
  id: "review_requested",
  name: "Review requested",
  group: "Other PRs",
  defaultSeverity: "normal",
  defaultChannels: ["list", "push"],
  detect(snapshot, ctx) {
    const request = openRequest(snapshot, ctx);
    if (!request || request.reviewedBefore) return [];
    return [
      requestItem(
        "review_requested",
        "rr",
        "Review requested",
        snapshot,
        request,
      ),
    ];
  },
};

export const reRequested: Rule = {
  id: "re_requested",
  name: "Review re-requested",
  group: "Other PRs",
  defaultSeverity: "high",
  defaultChannels: ["list", "push"],
  detect(snapshot, ctx) {
    const request = openRequest(snapshot, ctx);
    if (!request?.reviewedBefore) return [];
    return [
      requestItem(
        "re_requested",
        "rrr",
        "Review requested again",
        snapshot,
        request,
      ),
    ];
  },
};
