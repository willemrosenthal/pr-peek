import type { Db } from "../src/db";
import type { Prisma } from "../src/generated/prisma/client";
import { hours, NOW } from "./fakes";

// Creates stored PRs and items directly, for tests that don't need a sync.
export function itemRows(db: Db) {
  async function makePr(
    userId: string,
    number = 7,
    fields: Partial<
      Pick<
        Prisma.PullRequestUncheckedCreateInput,
        | "authorLogin"
        | "isDraft"
        | "state"
        | "githubUpdatedAt"
        | "quietAt"
        | "importantAt"
        | "snapshot"
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
        snapshot: {},
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
