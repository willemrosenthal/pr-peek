-- PRs added by their link (plan 17).
ALTER TABLE "PullRequest" ADD COLUMN "addedAt" TIMESTAMP(3);

-- PRs with nothing to do that fit no other section move from "review" to "watching".
-- Open ones are fetched again by the full pass after the deploy. Merged ones never are,
-- so the worker's start-up fill (backfill.ts) works their section out again from the
-- snapshot, for rows with an empty "lastPushSha". It only matters for open PRs.
UPDATE "PullRequest" SET "lastPushSha" = NULL
WHERE "state" = 'merged' AND "listGroup" = 'review' AND "snapshot" IS NOT NULL;
