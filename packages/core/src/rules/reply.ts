import {
  commentsItem,
  isAfter,
  isOther,
  isViewer,
  isViewerThread,
  mentionsViewer,
  sameLogin,
  viewerLastActivity,
} from "./helpers";
import type { Rule } from "./types";

// Replies after your latest comment or review: in open review threads you commented in,
// and the PR author's comments in the conversation. @mentions in the conversation and in
// threads you aren't in are the "mention" rule's.
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

    const replies = [
      ...snapshot.threads
        .filter((thread) => !thread.isResolved && isViewerThread(thread, ctx))
        .flatMap((thread) => thread.comments),
      ...snapshot.comments.filter(
        (comment) =>
          sameLogin(comment.author.login, snapshot.author.login) &&
          !mentionsViewer(comment, ctx),
      ),
    ].filter(
      (comment) =>
        isOther(comment.author, ctx) && isAfter(comment.createdAt, since),
    );
    return commentsItem("reply", `reply:${snapshot.id}`, replies);
  },
};
