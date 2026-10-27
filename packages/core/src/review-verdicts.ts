import type { ReviewerStatus } from "./api/preview";
import type { PrReview, PrSnapshot } from "./pr-snapshot";

export type ReviewVerdict = Exclude<ReviewerStatus, "requested">;

const isVerdict = (state: PrReview["state"]) =>
  state === "APPROVED" ||
  state === "CHANGES_REQUESTED" ||
  state === "DISMISSED";

// Where a person's reviews, oldest first, leave them, like GitHub shows it: their latest
// approval or change request. A later comment-only review doesn't replace it, and a
// dismissed one clears it. Only comments: "commented".
export function verdictOf(reviews: PrReview[]): ReviewVerdict {
  const verdict = reviews.findLast((review) => isVerdict(review.state));
  if (verdict?.state === "APPROVED") return "approved";
  if (verdict?.state === "CHANGES_REQUESTED") return "changes_requested";
  return "commented";
}

// Each person's reviews, oldest first, keyed by lowercase login, in order of their
// latest. The author's own reviews are replies, and bots (like Copilot's AI reviewer)
// aren't people to wait on, so both are left out.
export function reviewsByPerson(snapshot: PrSnapshot): Map<string, PrReview[]> {
  const author = snapshot.author.login.toLowerCase();
  const byPerson = new Map<string, PrReview[]>();
  const reviews = snapshot.reviews.toSorted((a, b) =>
    a.submittedAt.localeCompare(b.submittedAt),
  );
  for (const review of reviews) {
    const login = review.author.login.toLowerCase();
    if (review.author.isBot || login === author) continue;
    const theirs = byPerson.get(login) ?? [];
    byPerson.delete(login);
    byPerson.set(login, [...theirs, review]);
  }
  return byPerson;
}
