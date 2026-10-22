import {
  commentsItem,
  isAfter,
  isOther,
  isViewer,
  viewerLastActivity,
} from "./helpers";
import type { Rule } from "./types";

// Comments by others on your PR, after your latest comment and your latest commit.
// Comments in resolved threads don't count.
export const commented: Rule = {
  id: "commented",
  name: "New comment on my PR",
  group: "My PRs",
  defaultSeverity: "low",
  defaultChannels: ["list"],
  detect(snapshot, ctx) {
    if (!isViewer(snapshot.author, ctx)) return [];

    const lastActivity = viewerLastActivity(snapshot, ctx);
    const since =
      lastActivity && isAfter(lastActivity, snapshot.headCommittedAt)
        ? lastActivity
        : snapshot.headCommittedAt;
    const comments = [
      ...snapshot.comments,
      ...snapshot.threads
        .filter((thread) => !thread.isResolved)
        .flatMap((thread) => thread.comments),
    ].filter(
      (comment) =>
        isOther(comment.author, ctx) && isAfter(comment.createdAt, since),
    );
    return commentsItem("commented", `commented:${snapshot.id}`, comments);
  },
};
