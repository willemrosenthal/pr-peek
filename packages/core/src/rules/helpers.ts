import type { PrActor, PrComment, PrSnapshot } from "../pr-snapshot";
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

// Conversation comments and review thread comments together.
export const allComments = (snapshot: PrSnapshot) => [
  ...snapshot.comments,
  ...snapshot.threads.flatMap((thread) => thread.comments),
];

// When the viewer last commented on or reviewed the PR, or null if never.
export function viewerLastActivity(
  snapshot: PrSnapshot,
  ctx: RuleContext,
): string | null {
  const times = [
    ...allComments(snapshot)
      .filter((comment) => isViewer(comment.author, ctx))
      .map((comment) => comment.createdAt),
    ...snapshot.reviews
      .filter((review) => isViewer(review.author, ctx))
      .map((review) => review.submittedAt),
  ];
  return latestBy(times, (time) => time) ?? null;
}

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
      summary: `${latest.author.login}: "${latest.bodyPreview}"${andMore(comments.length)}`,
      occurredAt: latest.createdAt,
      waitingSince: null,
    },
  ];
}
