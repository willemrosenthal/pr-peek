import type { PrSnapshot } from "./pr-snapshot";

// What an assigned PR needs next. The list shows it on the row.
export type AssignedState =
  | "draft"
  | "conflicts"
  | "checks_failing"
  | "changes_requested"
  | "ready_to_merge"
  | "checks_running"
  | "waiting_on_review";

// The first state that matches, in the order above.
export function assignedState(snapshot: PrSnapshot): AssignedState {
  const checks = snapshot.checks.state;
  if (snapshot.isDraft) return "draft";
  if (snapshot.mergeable === "CONFLICTING") return "conflicts";
  if (checks === "FAILURE" || checks === "ERROR") return "checks_failing";
  if (snapshot.reviewDecision === "CHANGES_REQUESTED") {
    return "changes_requested";
  }
  const running = checks === "PENDING" || checks === "EXPECTED";
  if (snapshot.reviewDecision === "APPROVED" && !running) {
    return "ready_to_merge";
  }
  if (running) return "checks_running";
  return "waiting_on_review";
}
