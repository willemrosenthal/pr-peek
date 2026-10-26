import type {
  PrReview,
  PrSnapshot,
  ReviewerDto,
  ReviewerStatus,
} from "@pr-peek/core";

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
// and so are bots' reviews. `viewerLogin` is the signed in user's, to mark them.
export function reviewersOf(
  snapshot: PrSnapshot,
  viewerLogin: string,
): ReviewerDto[] {
  // GitHub logins don't depend on case.
  const key = (login: string) => login.toLowerCase();
  const author = key(snapshot.author.login);
  const person = (login: string, status: ReviewerStatus): ReviewerDto => ({
    name: login,
    isTeam: false,
    isYou: key(login) === key(viewerLogin),
    status,
  });

  const waiting: ReviewerDto[] = snapshot.reviewRequests.map((request) =>
    request.type === "team"
      ? { name: request.slug, isTeam: true, isYou: false, status: "requested" }
      : person(request.login, "requested"),
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

  const reviewed = [...byPerson.values()].map((theirs) =>
    person(theirs[0]!.author.login, statusOf(theirs)),
  );
  return [...waiting, ...reviewed];
}
