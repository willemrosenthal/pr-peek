import type {
  PrActor,
  PrComment,
  PrReview,
  PrSnapshot,
  PrThread,
} from "../pr-snapshot";
import type { DetectedItem, ItemKind, RuleContext } from "./types";

// GitHub logins aren't case sensitive.
export const sameLogin = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();

export const isViewer = (actor: PrActor, ctx: RuleContext) =>
  sameLogin(actor.login, ctx.viewerLogin);

// Someone whose actions the rules count: not the viewer, and not a hidden bot.
export const isOther = (actor: PrActor, ctx: RuleContext) =>
  !isViewer(actor, ctx) && !(ctx.settings.hideBots && actor.isBot);

// True if `time` is after `since`. Everything is after null.
export const isAfter = (time: string, since: string | null) =>
  since === null || Date.parse(time) > Date.parse(since);

// The item with the latest time, or undefined if there are none.
export function latestBy<T>(items: T[], time: (item: T) => string) {
  return items.reduce<T | undefined>(
    (latest, item) =>
      latest === undefined || isAfter(time(item), time(latest)) ? item : latest,
    undefined,
  );
}

// A review thread the viewer commented in.
export const isViewerThread = (thread: PrThread, ctx: RuleContext) =>
  thread.comments.some((comment) => isViewer(comment.author, ctx));

// True if the comment @mentions the viewer.
export const mentionsViewer = (comment: PrComment, ctx: RuleContext) =>
  comment.mentions.some((login) => sameLogin(login, ctx.viewerLogin));

// A review's summary text, as a comment.
export const reviewSummary = (review: PrReview): PrComment => ({
  id: review.id,
  author: review.author,
  bodyPreview: review.bodyPreview ?? "",
  mentions: review.mentions ?? [],
  createdAt: review.submittedAt,
  replyToId: null,
});

// Conversation comments and review thread comments together.
export const allComments = (snapshot: PrSnapshot) => [
  ...snapshot.comments,
  ...snapshot.threads.flatMap((thread) => thread.comments),
];

// When the viewer commented on or reviewed the PR, in no order.
export const viewerActivity = (snapshot: PrSnapshot, ctx: RuleContext) => [
  ...allComments(snapshot)
    .filter((comment) => isViewer(comment.author, ctx))
    .map((comment) => comment.createdAt),
  ...snapshot.reviews
    .filter((review) => isViewer(review.author, ctx))
    .map((review) => review.submittedAt),
];

// When the viewer last commented on or reviewed the PR, or null if never.
export const viewerLastActivity = (snapshot: PrSnapshot, ctx: RuleContext) =>
  latestBy(viewerActivity(snapshot, ctx), (time) => time) ?? null;

// The author's latest real push. Merges from the base branch, like "Update branch",
// don't count. Falls back to the head commit when the snapshot doesn't say.
export const lastPushOf = (snapshot: PrSnapshot) =>
  snapshot.lastPush ?? {
    sha: snapshot.headSha,
    committedAt: snapshot.headCommittedAt,
    checksFailed: snapshot.checks.failing.length > 0,
  };

// " (+2 more)" when there's more than one, or nothing.
export const andMore = (count: number) =>
  count > 1 ? ` (+${count - 1} more)` : "";

// One item for a group of comments, summed up by the latest. None if the list is empty.
export function commentsItem(
  kind: ItemKind,
  dedupeKey: string,
  comments: PrComment[],
): DetectedItem[] {
  const latest = latestBy(comments, (comment) => comment.createdAt);
  if (!latest) return [];
  return [
    {
      kind,
      dedupeKey,
      latestEventId: latest.id,
      eventCount: comments.length,
      actorLogin: latest.author.login,
      actorIsBot: latest.author.isBot,
      summary: `${latest.author.login}: "${latest.bodyPreview}"${andMore(comments.length)}`,
      occurredAt: latest.createdAt,
      waitingSince: null,
      waitingOnAuthor: false,
    },
  ];
}
