-- When the user finished onboarding. An added column only, so the live code keeps
-- working while this deploys.
ALTER TABLE "UserSettings" ADD COLUMN "onboardedAt" TIMESTAMP(3);

-- Until now, onboarding couldn't be passed without a repo, so anyone watching one is
-- past it.
UPDATE "UserSettings" s
SET "onboardedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "WatchedRepo" r WHERE r."userId" = s."userId");
