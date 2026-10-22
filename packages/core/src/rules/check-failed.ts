import { isViewer } from "./helpers";
import type { Rule } from "./types";

// Failing checks on your PR's latest commit. A new commit makes a new item.
export const checkFailed: Rule = {
  id: "check_failed",
  name: "Check failed on my PR",
  group: "My PRs",
  defaultSeverity: "high",
  defaultChannels: ["list", "push"],
  detect(snapshot, ctx) {
    if (!isViewer(snapshot.author, ctx)) return [];
    const { state, failing } = snapshot.checks;
    if (state !== "FAILURE" && state !== "ERROR") return [];

    return [
      {
        kind: "check_failed",
        dedupeKey: `check:${snapshot.id}:${snapshot.headSha}`,
        // Stays the same when more checks fail on the same commit, so it notifies once.
        latestEventId: snapshot.headSha,
        eventCount: Math.max(failing.length, 1),
        actorLogin: null,
        summary:
          failing.length > 0
            ? failing.map((check) => check.name).join(", ")
            : "Checks failed",
        // Checks don't come with a finish time, so use the commit's.
        occurredAt: snapshot.headCommittedAt,
        waitingSince: null,
      },
    ];
  },
};
