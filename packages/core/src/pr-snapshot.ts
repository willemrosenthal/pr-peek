import { z } from "zod";

// A trimmed copy of one PR, saved by the sync (plan 04) and read by the rules (plan 05).
// Dates are ISO strings because it's stored as JSON.

// A user or bot on GitHub. Deleted accounts show up as "ghost".
export const prActor = z.object({ login: z.string(), isBot: z.boolean() });
export type PrActor = z.infer<typeof prActor>;

// Someone asked to review: a person, or a team as "org/team-slug".
export const prReviewer = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), login: z.string() }),
  z.object({ type: z.literal("team"), slug: z.string() }),
]);
export type PrReviewer = z.infer<typeof prReviewer>;

export const prReviewRequestEvent = z.object({
  id: z.string(),
  action: z.enum(["requested", "removed"]),
  reviewer: prReviewer,
  createdAt: z.string(),
});
export type PrReviewRequestEvent = z.infer<typeof prReviewRequestEvent>;

export const prReview = z.object({
  id: z.string(),
  author: prActor,
  state: z.enum(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"]),
  submittedAt: z.string(),
  // The review's summary text, like a comment's. Missing in snapshots stored before
  // they were added.
  bodyPreview: z.string().optional(),
  mentions: z.array(z.string()).optional(),
});
export type PrReview = z.infer<typeof prReview>;

export const prComment = z.object({
  id: z.string(),
  author: prActor,
  // The first 200 characters, on one line.
  bodyPreview: z.string(),
  // Lowercase logins @mentioned anywhere in the full body.
  mentions: z.array(z.string()),
  createdAt: z.string(),
  // In a review thread, the comment this one answers.
  replyToId: z.string().nullable(),
});
export type PrComment = z.infer<typeof prComment>;

export const prThread = z.object({
  id: z.string(),
  isResolved: z.boolean(),
  comments: z.array(prComment),
});
export type PrThread = z.infer<typeof prThread>;

// Someone was assigned to the PR, or taken off it.
export const prAssignEvent = z.object({
  id: z.string(),
  action: z.enum(["assigned", "unassigned"]),
  // The login assigned or taken off.
  assignee: z.string(),
  // Who did it.
  actor: prActor,
  createdAt: z.string(),
});
export type PrAssignEvent = z.infer<typeof prAssignEvent>;

// GitHub's overall result for the latest commit's checks.
export const checkState = z.enum([
  "SUCCESS",
  "FAILURE",
  "ERROR",
  "PENDING",
  "EXPECTED",
]);
export type CheckState = z.infer<typeof checkState>;

export const prSnapshot = z.object({
  id: z.string(),
  number: z.number(),
  repo: z.object({ owner: z.string(), name: z.string() }),
  title: z.string(),
  url: z.string(),
  author: prActor,
  isDraft: z.boolean(),
  headSha: z.string(),
  headCommittedAt: z.string(),
  updatedAt: z.string(),
  reviewRequests: z.array(prReviewer),
  reviewRequestEvents: z.array(prReviewRequestEvent),
  reviews: z.array(prReview),
  // The four below are missing in snapshots stored before they were added.
  // Logins of the PR's assignees.
  assignees: z.array(z.string()).optional(),
  assignEvents: z.array(prAssignEvent).optional(),
  // GitHub's review verdict, as the branch rules see it. Null when reviews aren't required
  // and nobody approved or asked for changes.
  reviewDecision: z
    .enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])
    .nullable()
    .optional(),
  // UNKNOWN while GitHub is still working it out.
  mergeable: z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]).optional(),
  threads: z.array(prThread),
  comments: z.array(prComment),
  // The PR's description, as a comment by its author when the PR was opened. Missing in
  // snapshots stored before it was added.
  description: prComment.optional(),
  checks: z.object({
    // From the newest run of each check, as GitHub's PR page shows them. Null when the
    // commit has no checks.
    state: checkState.nullable(),
    // GitHub's own state, which counts every run. The searches give this one, so the sync
    // compares it to notice when checks change. Same as `state` when missing.
    githubState: checkState.nullable().optional(),
    failing: z.array(
      z.object({ name: z.string(), url: z.string().nullable() }),
    ),
  }),
  // The newest commit that isn't a merge, like the one "Update branch" adds. Missing in
  // snapshots stored before it was added, or when the latest 20 commits are all merges.
  lastPush: z
    .object({
      sha: z.string(),
      committedAt: z.string(),
      // A check failed. Cancelled runs, like ones a newer commit stopped, don't count.
      checksFailed: z.boolean(),
    })
    .optional(),
});
export type PrSnapshot = z.infer<typeof prSnapshot>;
