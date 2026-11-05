-- Nothing reads PR snapshots since plan 16 PR 5b, and plan 17 used them once.
ALTER TABLE "PullRequest" DROP COLUMN "snapshot";
