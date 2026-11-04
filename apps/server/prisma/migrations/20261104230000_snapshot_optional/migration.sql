-- The sync stops writing snapshots (plan 16). Dropped in a later release.
ALTER TABLE "PullRequest" ALTER COLUMN "snapshot" DROP NOT NULL;
