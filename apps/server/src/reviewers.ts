import type { PrReview, PrSnapshot, ReviewerStatus } from "@pr-peek/core";

export interface Reviewer {
  // A person's login, or a team as "org/team-slug".
  name: string;
  isTeam: boolean;
  status: ReviewerStatus;
}

const isVerdict = (state: PrReview["state"]) =>
  state === "APPROVED" ||
  state === "CHANGES_REQUESTED" ||
  state === "DISMISSED";

// Where a person's reviews leave them, like GitHub shows it: their latest approval or
// change request. A later comment-only review doesn't replace it, and a dismissed one
// clears it. Only comments: "commented".
function statusOf(reviews: PrReview[]): ReviewerStatus {
  const verdict = reviews.findLast((review) => isVerdict(review.state));
  if (verdict?.state === "APPROVED") return "approved";
  if (verdict?.state === "CHANGES_REQUESTED") return "changes_requested";
  return "commented";
}

// Everyone asked to review the PR, and everyone who has: those still waiting first (in
// the order they were asked), then the rest by their latest review. Someone asked again
// after reviewing is waiting. The author's own reviews are replies, so they're left out,
// and so are bots' reviews.
export function reviewersOf(snapshot: PrSnapshot): Reviewer[] {
  const key = (login: string) => login.toLowerCase();
  const author = key(snapshot.author.login);

  const waiting: Reviewer[] = snapshot.reviewRequests.map((request) =>
    request.type === "team"
      ? { name: request.slug, isTeam: true, status: "requested" }
      : { name: request.login, isTeam: false, status: "requested" },
  );
  const asked = new Set(
    waiting.filter((r) => !r.isTeam).map((r) => key(r.name)),
  );

  // Each person's reviews, oldest first, in order of their latest.
  const byPerson = new Map<string, PrReview[]>();
  const reviews = snapshot.reviews.toSorted((a, b) =>
    a.submittedAt.localeCompare(b.submittedAt),
  );
  for (const review of reviews) {
    const login = key(review.author.login);
    // Bots, like Copilot's AI reviewer, aren't people to wait on.
    if (review.author.isBot || login === author || asked.has(login)) continue;
    const theirs = byPerson.get(login) ?? [];
    byPerson.delete(login);
    byPerson.set(login, [...theirs, review]);
  }

  const reviewed = [...byPerson.values()].map((theirs): Reviewer => ({
    name: theirs[0]!.author.login,
    isTeam: false,
    status: statusOf(theirs),
  }));
  return [...waiting, ...reviewed];
}
