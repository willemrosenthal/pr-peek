import type { CheckState } from "../pr-snapshot";
import { isViewer, lastPushOf } from "./helpers";
import type { Rule } from "./types";

const isFailure = (state: CheckState | null) =>
  state === "FAILURE" || state === "ERROR";

// Failing checks on your PR's latest push. A new push makes a new item. "Update branch"
// doesn't: until the merge commit's checks pass, the last push's failure stands.
export const checkFailed: Rule = {
  id: "check_failed",
  name: "Check failed on my PR",
  group: "My PRs",
  defaultSeverity: "high",
  defaultChannels: ["list", "push"],
  detect(snapshot, ctx) {
    if (!isViewer(snapshot.author, ctx)) return [];
    const push = lastPushOf(snapshot);
    const { state, failing } = snapshot.checks;
    const headFailed = isFailure(state);
    const updatedAfterFailure =
      push.sha !== snapshot.headSha &&
      state !== "SUCCESS" &&
      isFailure(push.checkState);
    if (!headFailed && !updatedAfterFailure) return [];

    return [
      {
        kind: "check_failed",
        dedupeKey: `check:${snapshot.id}:${push.sha}`,
        // Stays the same when more checks fail on the same push, so it notifies once.
        latestEventId: push.sha,
        eventCount: headFailed ? Math.max(failing.length, 1) : 1,
        actorLogin: null,
        summary: headFailed
          ? failing.map((check) => check.name).join(", ") || "Checks failed"
          : "Checks failed before the branch update",
        // Checks don't come with a finish time, so use the push's.
        occurredAt: push.committedAt,
        waitingSince: null,
      },
    ];
  },
};
