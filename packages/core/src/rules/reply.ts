import {
  commentsItem,
  isAfter,
  isOther,
  isViewer,
  isViewerThread,
  viewerLastActivity,
} from "./helpers";
import type { Rule } from "./types";

// Replies in open review threads you commented in, after your latest comment or review.
// @mentions elsewhere are the "mention" rule's.
export const reply: Rule = {
  id: "reply",
  name: "Reply to my comment",
  group: "Other PRs",
  defaultSeverity: "normal",
  defaultChannels: ["list", "push"],
  detect(snapshot, ctx) {
    // Comments on your own PR are the "commented" rule's job.
    if (isViewer(snapshot.author, ctx)) return [];
    const since = viewerLastActivity(snapshot, ctx);
    if (since === null) return [];

    const replies = snapshot.threads
      .filter((thread) => !thread.isResolved && isViewerThread(thread, ctx))
      .flatMap((thread) => thread.comments)
      .filter(
        (comment) =>
          isOther(comment.author, ctx) && isAfter(comment.createdAt, since),
      );
    return commentsItem("reply", `reply:${snapshot.id}`, replies);
  },
};
