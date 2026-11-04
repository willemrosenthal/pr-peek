import type { PrSnapshot } from "./pr-snapshot";
import { reviewsByPerson, verdictOf } from "./review-verdicts";

// What an assigned PR needs next. The list shows it on the row.
export const ASSIGNED_STATES = [
  "draft",
  "conflicts",
  "checks_failing",
  "changes_requested",
  "ready_to_merge",
  "checks_running",
  "waiting_on_review",
] as const;
export type AssignedState = (typeof ASSIGNED_STATES)[number];

// GitHub's review verdict. Repos that don't require reviews have none, so it comes from
// each reviewer's latest verdict instead: any change request, else any approval.
function decisionOf(snapshot: PrSnapshot) {
  if (snapshot.reviewDecision) return snapshot.reviewDecision;
  const verdicts = [...reviewsByPerson(snapshot).values()].map(verdictOf);
  if (verdicts.includes("changes_requested")) return "CHANGES_REQUESTED";
  if (verdicts.includes("approved")) return "APPROVED";
  return null;
}

// The first state that matches, in the order above.
export function assignedState(snapshot: PrSnapshot): AssignedState {
  const checks = snapshot.checks.state;
  if (snapshot.isDraft) return "draft";
  if (snapshot.mergeable === "CONFLICTING") return "conflicts";
  if (checks === "FAILURE" || checks === "ERROR") return "checks_failing";
  const decision = decisionOf(snapshot);
  if (decision === "CHANGES_REQUESTED") return "changes_requested";
  const running = checks === "PENDING" || checks === "EXPECTED";
  if (decision === "APPROVED" && !running) return "ready_to_merge";
  if (running) return "checks_running";
  return "waiting_on_review";
}
