-- What the list needs from a PR's details, so it stops reading snapshots (plan 16).
ALTER TABLE "PullRequest" ADD COLUMN     "assignedState" TEXT,
ADD COLUMN     "lastPushSha" TEXT,
ADD COLUMN     "listGroup" TEXT;

-- When the rules last ran on every PR, and the user's teams.
ALTER TABLE "User" ADD COLUMN     "rulesRunAt" TIMESTAMP(3),
ADD COLUMN     "rulesStaleAt" TIMESTAMP(3),
ADD COLUMN     "teams" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "teamsCheckedAt" TIMESTAMP(3);
