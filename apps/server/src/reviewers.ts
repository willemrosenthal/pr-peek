import {
  reviewsByPerson,
  verdictOf,
  type PrSnapshot,
  type ReviewerDto,
  type ReviewerStatus,
} from "@pr-peek/core";

// Everyone asked to review the PR, and everyone who has: those still waiting first (in
// the order they were asked), then the rest by their latest review. Someone asked again
// after reviewing is waiting. The author's own reviews are replies, so they're left out,
// and so are bots' reviews. `viewerLogin` is the signed in user's, to mark them.
export function reviewersOf(
  pr: Pick<PrSnapshot, "author" | "reviews" | "reviewRequests">,
  viewerLogin: string,
): ReviewerDto[] {
  // GitHub logins don't depend on case.
  const key = (login: string) => login.toLowerCase();
  const person = (login: string, status: ReviewerStatus): ReviewerDto => ({
    name: login,
    isTeam: false,
    isYou: key(login) === key(viewerLogin),
    status,
  });

  const waiting: ReviewerDto[] = pr.reviewRequests.map((request) =>
    request.type === "team"
      ? { name: request.slug, isTeam: true, isYou: false, status: "requested" }
      : person(request.login, "requested"),
  );
  const asked = new Set(
    waiting.filter((r) => !r.isTeam).map((r) => key(r.name)),
  );

  const reviewed = [...reviewsByPerson(pr)]
    .filter(([login]) => !asked.has(login))
    .map(([, theirs]) => person(theirs[0]!.author.login, verdictOf(theirs)));
  return [...waiting, ...reviewed];
}
