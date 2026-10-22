import {
  commentsItem,
  isAfter,
  isOther,
  isViewer,
  isViewerThread,
  mentionsViewer,
  viewerLastActivity,
} from "./helpers";
import type { Rule } from "./types";

// @mentions of you on other people's PRs: in the description, the conversation, or an
// open review thread you aren't in. Replies in your threads are the "reply" rule's.
// Only mentions after your latest comment or review count.
export const mention: Rule = {
  id: "mention",
  name: "Mentioned me",
  group: "Other PRs",
  defaultSeverity: "normal",
  defaultChannels: ["list", "push"],
  detect(snapshot, ctx) {
    // Comments on your own PR are the "commented" rule's job.
    if (isViewer(snapshot.author, ctx)) return [];
    const since = viewerLastActivity(snapshot, ctx);

    const mentions = [
      ...(snapshot.description ? [snapshot.description] : []),
      ...snapshot.comments,
      ...snapshot.threads
        .filter((thread) => !thread.isResolved && !isViewerThread(thread, ctx))
        .flatMap((thread) => thread.comments),
    ].filter(
      (comment) =>
        mentionsViewer(comment, ctx) &&
        isOther(comment.author, ctx) &&
        isAfter(comment.createdAt, since),
    );
    return commentsItem("mention", `mention:${snapshot.id}`, mentions);
  },
};
