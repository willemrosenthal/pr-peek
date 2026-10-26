import type {
  PrReview,
  PrReviewer,
  PrReviewRequestEvent,
  PrSnapshot,
} from "../pr-snapshot";
import {
  allComments,
  isAfter,
  isViewer,
  lastPushOf,
  latestBy,
  sameLogin,
  viewerActivity,
} from "./helpers";
import type { DetectedItem, ItemKind, Rule, RuleContext } from "./types";

interface OpenRequest {
  // The latest request event for the viewer. Missing if it's older than the fetched timeline.
  event: PrReviewRequestEvent | undefined;
  // The viewer reviewed before this request, so it's a re-request.
  reviewedBefore: boolean;
}

// Reviews that end a request. A "Comment" review doesn't: you still owe a verdict.
const isVerdict = (review: PrReview) =>
  review.state === "APPROVED" || review.state === "CHANGES_REQUESTED";

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
  const latestEvent = (action: PrReviewRequestEvent["action"]) =>
    latestBy(
      snapshot.reviewRequestEvents.filter(
        (e) => e.action === action && forViewer(e.reviewer),
      ),
      (e) => e.createdAt,
    );
  const event = latestEvent("requested");
  const removed = latestEvent("removed");
  const reviews = snapshot.reviews.filter((review) =>
    isViewer(review.author, ctx),
  );
  // GitHub drops the request when you submit any review, even a "Comment" one, without
  // a "removed" event. So a request you reviewed since, that nobody took back, counts.
  const asked =
    snapshot.reviewRequests.some(forViewer) ||
    (event !== undefined &&
      (!removed || isAfter(event.createdAt, removed.createdAt)) &&
      reviews.some((r) => isAfter(r.submittedAt, event.createdAt)));
  if (!asked) return null;

  const lastVerdict = latestBy(reviews.filter(isVerdict), (r) => r.submittedAt);
  // Approved or asked for changes since the request. GitHub can leave a team request in
  // place after a member reviews. Without the event we can't tell the order, so assume
  // the review came last.
  if (
    lastVerdict &&
    (!event || !isAfter(event.createdAt, lastVerdict.submittedAt))
  ) {
    return null;
  }
  return {
    event,
    reviewedBefore: event
      ? reviews.some((r) => !isAfter(r.submittedAt, event.createdAt))
      : false,
  };
}

interface AuthorTurn {
  // The viewer's latest comment or review since the request. Missing if none.
  lastMine: string | undefined;
  // When the author first replied or pushed after that. Missing while it's their turn.
  answeredAt: string | undefined;
}

// Whose turn it is once the viewer has commented on a requested review.
function authorTurn(
  snapshot: PrSnapshot,
  ctx: RuleContext,
  { event }: OpenRequest,
): AuthorTurn {
  const since = event?.createdAt ?? null;
  const lastMine = latestBy(
    viewerActivity(snapshot, ctx).filter((t) => isAfter(t, since)),
    (t) => t,
  );
  if (!lastMine) return { lastMine, answeredAt: undefined };

  // ISO times, so they sort by time.
  const answers = [
    ...allComments(snapshot)
      .filter((comment) =>
        sameLogin(comment.author.login, snapshot.author.login),
      )
      .map((comment) => comment.createdAt),
    lastPushOf(snapshot).committedAt,
  ]
    .filter((t) => isAfter(t, lastMine))
    .sort();
  return { lastMine, answeredAt: answers[0] };
}

function requestItem(
  kind: ItemKind,
  prefix: string,
  summary: string,
  snapshot: PrSnapshot,
  ctx: RuleContext,
  request: OpenRequest,
): DetectedItem {
  const { event } = request;
  const eventId = event?.id ?? "current";
  const team = event?.reviewer.type === "team" ? event.reviewer.slug : null;
  const { lastMine, answeredAt } = authorTurn(snapshot, ctx, request);
  const waiting = lastMine !== undefined && answeredAt === undefined;
  const startedAt = answeredAt ?? event?.createdAt;
  return {
    kind,
    dedupeKey: `${prefix}:${snapshot.id}:${eventId}`,
    // The author answering your latest comment is a new event, so the item turns unseen
    // and can push. It's named by your comment, so more pushes or replies from the
    // author aren't new events, and the clock runs from their first answer.
    latestEventId: answeredAt ? `${eventId}:${lastMine}` : eventId,
    eventCount: 1,
    actorLogin: null,
    actorIsBot: false,
    summary: team ? `${summary} from ${team}` : summary,
    occurredAt: (waiting ? lastMine : startedAt) ?? snapshot.updatedAt,
    waitingSince: waiting ? null : (startedAt ?? null),
    waitingOnAuthor: waiting,
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
        ctx,
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
        "Re-review requested",
        snapshot,
        ctx,
        request,
      ),
    ];
  },
};
