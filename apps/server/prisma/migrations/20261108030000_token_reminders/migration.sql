-- Plan 20: remember the reminders sent for each token, and when the sign in stopped while a
-- token still worked. The old token columns go: nothing has read or written them since 1.24.

ALTER TABLE "GitHubToken" ADD COLUMN "stopRemindedAt" TIMESTAMP(3);

ALTER TABLE "User" ADD COLUMN "signInStoppedAt" TIMESTAMP(3);

ALTER TABLE "User" DROP COLUMN "patEnc",
DROP COLUMN "patExpiresAt",
DROP COLUMN "patScopes";

-- Tokens that stopped before this were already shown as stopped. No push for them now.
UPDATE "GitHubToken" SET "stopRemindedAt" = COALESCE("stoppedAt", CURRENT_TIMESTAMP)
WHERE "status" = 'stopped';
