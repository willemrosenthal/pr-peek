import {
  commentsItem,
  isAfter,
  isOther,
  isViewer,
  sameLogin,
  viewerLastActivity,
} from "./helpers";
import type { Rule } from "./types";

// Replies in open threads you commented in, and conversation comments that mention you.
// Only those after your latest comment or review count.
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

    const inYourThreads = snapshot.threads
      .filter(
        (thread) =>
          !thread.isResolved &&
          thread.comments.some((comment) => isViewer(comment.author, ctx)),
      )
      .flatMap((thread) => thread.comments);
    const mentioningYou = snapshot.comments.filter((comment) =>
      comment.mentions.some((login) => sameLogin(login, ctx.viewerLogin)),
    );
    const replies = [...inYourThreads, ...mentioningYou].filter(
      (comment) =>
        isOther(comment.author, ctx) && isAfter(comment.createdAt, since),
    );
    return commentsItem("reply", `reply:${snapshot.id}`, replies);
  },
};
