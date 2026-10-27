import {
  checkState,
  type PrActor,
  type PrComment,
  prReview,
  type PrReviewer,
  type PrSnapshot,
} from "@pr-peek/core";
import type { Octokit } from "octokit";
import { z } from "zod";
import { type GraphQLErrorItem, partialDataOrThrow } from "./errors";

// PRs per request. Keeps each query well under GitHub's cost limits.
const DETAILS_BATCH_SIZE = 10;
const PREVIEW_LENGTH = 200;

export const ACTOR = `author { __typename login }`;
const REVIEWER = `requestedReviewer {
  __typename
  ... on User { login }
  ... on Bot { login }
  ... on Mannequin { login }
  ... on Team { combinedSlug }
}`;
const COMMENT = `id ${ACTOR} bodyText createdAt`;

const DETAILS_QUERY = `query ($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on PullRequest {
      id number title url isDraft updatedAt createdAt bodyText
      repository { name owner { login } }
      ${ACTOR}
      reviewRequests(first: 50) { nodes { ${REVIEWER} } }
      timelineItems(last: 50, itemTypes: [REVIEW_REQUESTED_EVENT, REVIEW_REQUEST_REMOVED_EVENT]) {
        nodes {
          __typename
          ... on ReviewRequestedEvent { id createdAt ${REVIEWER} }
          ... on ReviewRequestRemovedEvent { id createdAt ${REVIEWER} }
        }
      }
      reviews(last: 20) { nodes { id state submittedAt bodyText ${ACTOR} } }
      reviewThreads(last: 30) {
        nodes { id isResolved comments(last: 20) { nodes { ${COMMENT} replyTo { id } } } }
      }
      comments(last: 30) { nodes { ${COMMENT} } }
      recentCommits: commits(last: 20) {
        nodes {
          commit {
            oid committedDate parents { totalCount }
            statusCheckRollup {
              contexts {
                checkRunCountsByState { state count }
                statusContextCountsByState { state count }
              }
            }
          }
        }
      }
      commits(last: 1) {
        nodes {
          commit {
            oid committedDate
            statusCheckRollup {
              state
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun { name conclusion detailsUrl }
                  ... on StatusContext { context state targetUrl }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

export const rawActor = z.object({
  __typename: z.string(),
  login: z.string(),
});

const rawReviewer = z
  .object({
    __typename: z.string(),
    login: z.string().optional(),
    combinedSlug: z.string().optional(),
  })
  .nullable();

const rawComment = z.object({
  id: z.string(),
  author: rawActor.nullable(),
  bodyText: z.string(),
  createdAt: z.string(),
  replyTo: z.object({ id: z.string() }).nullable().optional(),
});

// Fine-grained tokens can't have the Checks permission, so GitHub hides each check run
// from them (path ends in `contexts.nodes.<index>`). Commit statuses still come through.
const isHiddenCheckRun = ({ type, path }: GraphQLErrorItem) =>
  type === "FORBIDDEN" &&
  path?.at(-2) === "nodes" &&
  path.at(-3) === "contexts";

const nodesOf = <T extends z.ZodType>(item: T) =>
  z.object({ nodes: z.array(item) });

const stateCount = z.object({ state: z.string(), count: z.number() });

// How many check runs and statuses ended each way.
const checkCounts = z.object({
  contexts: z.object({
    checkRunCountsByState: z.array(stateCount),
    statusContextCountsByState: z.array(stateCount),
  }),
});

const rawPr = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
  updatedAt: z.string(),
  createdAt: z.string(),
  bodyText: z.string(),
  repository: z.object({
    name: z.string(),
    owner: z.object({ login: z.string() }),
  }),
  author: rawActor.nullable(),
  reviewRequests: nodesOf(z.object({ requestedReviewer: rawReviewer })),
  timelineItems: nodesOf(
    z.object({
      __typename: z.enum(["ReviewRequestedEvent", "ReviewRequestRemovedEvent"]),
      id: z.string(),
      createdAt: z.string(),
      requestedReviewer: rawReviewer,
    }),
  ),
  reviews: nodesOf(
    z.object({
      id: z.string(),
      state: z.enum([...prReview.shape.state.options, "PENDING"]),
      submittedAt: z.string().nullable(),
      bodyText: z.string(),
      author: rawActor.nullable(),
    }),
  ),
  reviewThreads: nodesOf(
    z.object({
      id: z.string(),
      isResolved: z.boolean(),
      comments: nodesOf(rawComment),
    }),
  ),
  comments: nodesOf(rawComment),
  recentCommits: nodesOf(
    z.object({
      commit: z.object({
        oid: z.string(),
        committedDate: z.string(),
        parents: z.object({ totalCount: z.number() }),
        statusCheckRollup: checkCounts.nullable(),
      }),
    }),
  ),
  commits: z.object({
    nodes: z
      .array(
        z.object({
          commit: z.object({
            oid: z.string(),
            committedDate: z.string(),
            statusCheckRollup: z
              .object({
                state: checkState,
                contexts: nodesOf(
                  z
                    .object({
                      __typename: z.string(),
                      name: z.string().optional(),
                      conclusion: z.string().nullable().optional(),
                      detailsUrl: z.string().nullable().optional(),
                      context: z.string().optional(),
                      state: z.string().optional(),
                      targetUrl: z.string().nullable().optional(),
                    })
                    // A check run hidden from a fine-grained token.
                    .nullable(),
                ),
              })
              .nullable(),
          }),
        }),
      )
      .min(1),
  }),
});

type RawPr = z.infer<typeof rawPr>;

const FAILED_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "STARTUP_FAILURE",
  "ACTION_REQUIRED",
]);
const FAILED_STATES = new Set(["FAILURE", "ERROR"]);

// True if a check run or status failed. GitHub's overall state can't tell: it counts
// cancelled runs, like ones a newer commit stopped, as failures.
function checksFailed(rollup: z.infer<typeof checkCounts> | null): boolean {
  if (!rollup) return false;
  const any = (counts: z.infer<typeof stateCount>[], failed: Set<string>) =>
    counts.some((c) => failed.has(c.state) && c.count > 0);
  return (
    any(rollup.contexts.checkRunCountsByState, FAILED_CONCLUSIONS) ||
    any(rollup.contexts.statusContextCountsByState, FAILED_STATES)
  );
}

export const toActor = (actor: z.infer<typeof rawActor> | null): PrActor =>
  actor
    ? { login: actor.login, isBot: actor.__typename === "Bot" }
    : { login: "ghost", isBot: false };

function toReviewer(raw: z.infer<typeof rawReviewer>): PrReviewer | null {
  if (raw?.combinedSlug) return { type: "team", slug: raw.combinedSlug };
  if (raw?.login) return { type: "user", login: raw.login };
  return null;
}

// The first 200 characters, on one line.
export const preview = (text: string) =>
  text.replace(/\s+/g, " ").trim().slice(0, PREVIEW_LENGTH);

// A GitHub login after "@". Skips emails (word before "@") and teams ("@org/team").
const MENTION = /(?<![\w@])@([a-z\d](?:[a-z\d-]*[a-z\d])?)(?![\w/-])/gi;

// Logins @mentioned in the text, lowercase, each once.
export const mentionsIn = (text: string) => [
  ...new Set(
    [...text.matchAll(MENTION)].map((match) => match[1]!.toLowerCase()),
  ),
];

const toComment = (raw: z.infer<typeof rawComment>): PrComment => ({
  id: raw.id,
  author: toActor(raw.author),
  bodyPreview: preview(raw.bodyText),
  mentions: mentionsIn(raw.bodyText),
  createdAt: raw.createdAt,
  replyToId: raw.replyTo?.id ?? null,
});

function toSnapshot(raw: RawPr): PrSnapshot {
  // The schema requires at least one commit.
  const head = raw.commits.nodes[0]!.commit;
  const contexts = (head.statusCheckRollup?.contexts.nodes ?? []).filter(
    (c) => c !== null,
  );
  // A merge commit has two parents.
  const push = raw.recentCommits.nodes
    .map((node) => node.commit)
    .findLast((commit) => commit.parents.totalCount <= 1);

  return {
    id: raw.id,
    number: raw.number,
    repo: { owner: raw.repository.owner.login, name: raw.repository.name },
    title: raw.title,
    url: raw.url,
    author: toActor(raw.author),
    isDraft: raw.isDraft,
    headSha: head.oid,
    headCommittedAt: head.committedDate,
    updatedAt: raw.updatedAt,
    reviewRequests: raw.reviewRequests.nodes.flatMap(
      (r) => toReviewer(r.requestedReviewer) ?? [],
    ),
    reviewRequestEvents: raw.timelineItems.nodes.flatMap((event) => {
      const reviewer = toReviewer(event.requestedReviewer);
      if (!reviewer) return [];
      return {
        id: event.id,
        action:
          event.__typename === "ReviewRequestedEvent"
            ? ("requested" as const)
            : ("removed" as const),
        reviewer,
        createdAt: event.createdAt,
      };
    }),
    // Pending reviews are drafts only their author can see.
    reviews: raw.reviews.nodes.flatMap((review) =>
      review.state === "PENDING" || !review.submittedAt
        ? []
        : {
            id: review.id,
            author: toActor(review.author),
            state: review.state,
            submittedAt: review.submittedAt,
            bodyPreview: preview(review.bodyText),
            mentions: mentionsIn(review.bodyText),
          },
    ),
    description: toComment({
      id: `body:${raw.id}`,
      author: raw.author,
      bodyText: raw.bodyText,
      createdAt: raw.createdAt,
    }),
    threads: raw.reviewThreads.nodes.map((thread) => ({
      id: thread.id,
      isResolved: thread.isResolved,
      comments: thread.comments.nodes.map(toComment),
    })),
    comments: raw.comments.nodes.map(toComment),
    checks: {
      state: head.statusCheckRollup?.state ?? null,
      failing: contexts.flatMap((c) => {
        if (c.__typename === "CheckRun" && c.name) {
          return FAILED_CONCLUSIONS.has(c.conclusion ?? "")
            ? { name: c.name, url: c.detailsUrl ?? null }
            : [];
        }
        if (c.__typename === "StatusContext" && c.context) {
          return FAILED_STATES.has(c.state ?? "")
            ? { name: c.context, url: c.targetUrl ?? null }
            : [];
        }
        return [];
      }),
    },
    ...(push && {
      lastPush: {
        sha: push.oid,
        committedAt: push.committedDate,
        checksFailed: checksFailed(push.statusCheckRollup),
      },
    }),
  };
}

export interface PrDetails {
  snapshots: PrSnapshot[];
  // PRs that couldn't be read: gone, hidden, or in a shape we don't expect.
  failed: { id: string; error: string }[];
}

// Full details for each PR id, fetched in batches.
export async function fetchPrDetails(
  octokit: Octokit,
  ids: string[],
): Promise<PrDetails> {
  const result: PrDetails = { snapshots: [], failed: [] };

  for (let i = 0; i < ids.length; i += DETAILS_BATCH_SIZE) {
    const batch = ids.slice(i, i + DETAILS_BATCH_SIZE);
    const data: unknown = await octokit
      .graphql(DETAILS_QUERY, { ids: batch })
      .catch((err: unknown) =>
        partialDataOrThrow(err, ["NOT_FOUND"], isHiddenCheckRun),
      );
    const { nodes } = z.object({ nodes: z.array(z.unknown()) }).parse(data);

    batch.forEach((id, index) => {
      // One bad PR shouldn't stop the others from saving.
      const parsed = rawPr.safeParse(nodes[index]);
      if (parsed.success) {
        result.snapshots.push(toSnapshot(parsed.data));
      } else {
        result.failed.push({
          id,
          error: nodes[index] ? parsed.error.message : "not found",
        });
      }
    });
  }
  return result;
}
