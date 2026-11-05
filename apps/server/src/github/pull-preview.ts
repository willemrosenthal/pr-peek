import {
  prReview,
  type PrActor,
  type PrReview,
  type PrSnapshot,
} from "@pr-peek/core";
import type { Octokit } from "octokit";
import { z } from "zod";
import { partialDataOrThrow } from "./errors";
import {
  CHECK_CONTEXTS,
  failingChecks,
  isHiddenCheckRun,
  rawChecks,
} from "./checks";
import {
  ACTOR,
  rawActor,
  rawReviewer,
  REVIEWER,
  toActor,
  toReviewer,
} from "./pull-details";

// Bodies come as GitHub's HTML, already rendered from Markdown and cleaned by GitHub.
// The web app cleans them again before showing them.
const COMMENT = `id ${ACTOR} bodyHTML createdAt isMinimized`;

// Capped like the sync's query, which keeps it cheap. Each list keeps its newest.
const PREVIEW_QUERY = `query ($id: ID!) {
  node(id: $id) {
    ... on PullRequest {
      bodyHTML createdAt ${ACTOR}
      reviewRequests(first: 50) { nodes { ${REVIEWER} } }
      commits(last: 1) { nodes { commit { statusCheckRollup { ${CHECK_CONTEXTS} } } } }
      comments(last: 50) { nodes { ${COMMENT} } }
      reviews(last: 30) { nodes { id state submittedAt bodyHTML ${ACTOR} } }
      reviewThreads(last: 50) {
        nodes { path line originalLine comments(last: 50) { nodes { ${COMMENT} } } }
      }
    }
  }
}`;

const rawComment = z.object({
  id: z.string(),
  author: rawActor.nullable(),
  bodyHTML: z.string(),
  createdAt: z.string(),
  // Hidden on GitHub, like spam or an outdated bot comment.
  isMinimized: z.boolean(),
});

const shown = (comment: z.infer<typeof rawComment>) => !comment.isMinimized;

const nodesOf = <T extends z.ZodType>(item: T) =>
  z.object({ nodes: z.array(item) });

const rawPreview = z.object({
  bodyHTML: z.string(),
  createdAt: z.string(),
  author: rawActor.nullable(),
  reviewRequests: nodesOf(z.object({ requestedReviewer: rawReviewer })),
  commits: nodesOf(
    z.object({
      commit: z.object({
        statusCheckRollup: z.object({ contexts: rawChecks }).nullable(),
      }),
    }),
  ),
  comments: nodesOf(rawComment),
  reviews: nodesOf(
    z.object({
      id: z.string(),
      state: z.enum([...prReview.shape.state.options, "PENDING"]),
      submittedAt: z.string().nullable(),
      bodyHTML: z.string(),
      author: rawActor.nullable(),
    }),
  ),
  // `line` is null once the code the thread is on has changed.
  reviewThreads: nodesOf(
    z.object({
      path: z.string(),
      line: z.number().nullable(),
      originalLine: z.number().nullable(),
      comments: nodesOf(rawComment),
    }),
  ),
});
type RawPreview = z.infer<typeof rawPreview>;

export interface PreviewComment {
  id: string;
  author: PrActor;
  bodyHtml: string;
  createdAt: string;
  where: string | null;
  reviewState: PrReview["state"] | null;
}

// The fields `reviewersOf` needs, plus the failing checks on the latest commit.
export interface PrPreview extends Pick<
  PrSnapshot,
  "author" | "reviewRequests" | "reviews"
> {
  bodyHtml: string;
  createdAt: string;
  failingChecks: string[];
  comments: PreviewComment[];
  focusId: string | null;
}

const toComment = (
  comment: z.infer<typeof rawComment>,
  where: string | null,
): PreviewComment => ({
  id: comment.id,
  author: toActor(comment.author),
  bodyHtml: comment.bodyHTML.trim(),
  createdAt: comment.createdAt,
  where,
  reviewState: null,
});

// "path:line", or just the path once the line is gone.
function fileLine(thread: RawPreview["reviewThreads"]["nodes"][number]) {
  const line = thread.line ?? thread.originalLine;
  return line === null ? thread.path : `${thread.path}:${line}`;
}

// Submitted reviews. Pending ones are drafts only their author can see.
const submitted = (raw: RawPreview) =>
  raw.reviews.nodes.flatMap((review) =>
    review.state === "PENDING" || !review.submittedAt
      ? []
      : {
          ...review,
          state: review.state,
          submittedAt: review.submittedAt,
        },
  );

// The whole conversation, oldest first: comments, reviews, and comments on files.
// Approvals and change requests count even without text. Other reviews only with it,
// since an empty one just holds comments on files, which are listed on their own.
// Comments hidden on GitHub are left out.
function conversation(raw: RawPreview): PreviewComment[] {
  const reviews = submitted(raw).flatMap((review): PreviewComment[] => {
    const bodyHtml = review.bodyHTML.trim();
    const counts =
      review.state === "APPROVED" || review.state === "CHANGES_REQUESTED";
    if (!bodyHtml && !counts) return [];
    return [
      {
        id: review.id,
        author: toActor(review.author),
        bodyHtml,
        createdAt: review.submittedAt,
        where: null,
        reviewState: review.state,
      },
    ];
  });
  return [
    ...raw.comments.nodes
      .filter(shown)
      .map((comment) => toComment(comment, null)),
    ...reviews,
    ...raw.reviewThreads.nodes.flatMap((thread) =>
      thread.comments.nodes
        .filter(shown)
        .map((comment) => toComment(comment, fileLine(thread))),
    ),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// The PR's description, conversation, reviewers, and failing checks. `focusId` is the
// comment or review an item is about, kept when it's in the conversation. Null when the
// PR is gone from GitHub or hidden from the user.
export async function fetchPrPreview(
  octokit: Octokit,
  nodeId: string,
  focusId: string | null,
): Promise<PrPreview | null> {
  const data: unknown = await octokit
    .graphql(PREVIEW_QUERY, { id: nodeId })
    .catch((err: unknown) =>
      partialDataOrThrow(err, ["NOT_FOUND"], isHiddenCheckRun),
    );
  const { node } = z.object({ node: z.unknown() }).parse(data);
  if (!node) return null;
  const raw = rawPreview.parse(node);
  const comments = conversation(raw);
  const head = raw.commits.nodes[0]?.commit;
  return {
    bodyHtml: raw.bodyHTML.trim(),
    createdAt: raw.createdAt,
    author: toActor(raw.author),
    reviewRequests: raw.reviewRequests.nodes.flatMap(
      (r) => toReviewer(r.requestedReviewer) ?? [],
    ),
    reviews: submitted(raw).map((review): PrReview => ({
      id: review.id,
      author: toActor(review.author),
      state: review.state,
      submittedAt: review.submittedAt,
    })),
    failingChecks: failingChecks(head?.statusCheckRollup?.contexts).map(
      (check) => check.name,
    ),
    comments,
    focusId: comments.some((c) => c.id === focusId) ? focusId : null,
  };
}
