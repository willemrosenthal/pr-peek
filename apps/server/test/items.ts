import type { PrSnapshot } from "@pr-peek/core";
import type { Db } from "../src/db";
import type { Prisma } from "../src/generated/prisma/client";
import { hours, NOW } from "./fakes";

// PR_7's details, by sam, with passing checks and nothing else on it.
export const prDetails = (fields: Partial<PrSnapshot> = {}): PrSnapshot => ({
  id: "PR_7",
  number: 7,
  repo: { owner: "acme", name: "web-app" },
  title: "Add login",
  url: "https://github.com/acme/web-app/pull/7",
  author: { login: "sam", isBot: false },
  isDraft: false,
  headSha: "abc123",
  headCommittedAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  reviewRequests: [],
  reviewRequestEvents: [],
  reviews: [],
  threads: [],
  comments: [],
  checks: { state: "SUCCESS", failing: [] },
  ...fields,
});

// Creates stored PRs and items directly, for tests that don't need a sync.
export function itemRows(db: Db) {
  async function makePr(
    userId: string,
    number = 7,
    fields: Partial<
      Pick<
        Prisma.PullRequestUncheckedCreateInput,
        | "githubRepoId"
        | "repoOwner"
        | "authorLogin"
        | "isDraft"
        | "state"
        | "githubUpdatedAt"
        | "quietAt"
        | "importantAt"
        | "mergedAt"
        | "listGroup"
        | "assignedState"
        | "addedAt"
      >
    > = {},
  ) {
    return db.pullRequest.create({
      data: {
        userId,
        githubNodeId: `PR_${number}`,
        githubRepoId: 1,
        repoOwner: "acme",
        repoName: "web-app",
        number,
        title: "Add login",
        url: `https://github.com/acme/web-app/pull/${number}`,
        authorLogin: "sam",
        isDraft: false,
        state: "open",
        headSha: "abc123",
        githubUpdatedAt: NOW,
        ...fields,
      },
    });
  }

  async function makeItem(
    userId: string,
    pullRequestId: string,
    kind: string,
    fields: Partial<
      Pick<
        Prisma.ItemUncheckedCreateInput,
        | "occurredAt"
        | "waitingSince"
        | "waitingOnAuthor"
        | "status"
        | "resolvedAt"
        | "seenAt"
        | "latestEventId"
      >
    > = {},
  ) {
    return db.item.create({
      data: {
        userId,
        pullRequestId,
        kind,
        dedupeKey: `${kind}:${pullRequestId}`,
        latestEventId: "E_1",
        summary: `${kind} summary`,
        occurredAt: hours(-1),
        ...fields,
      },
    });
  }

  return { makePr, makeItem };
}
