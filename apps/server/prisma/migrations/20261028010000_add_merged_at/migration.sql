-- Important PRs stay on the list after they merge, and a push says so once.
ALTER TABLE "PullRequest" ADD COLUMN "mergedAt" TIMESTAMP(3),
ADD COLUMN "mergeNotifiedAt" TIMESTAMP(3);
