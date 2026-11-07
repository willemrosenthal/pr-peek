-- Plan 10: sign-up requests. A user waits for an admin until approvedAt is set.
ALTER TABLE "User" ADD COLUMN "approvedAt" TIMESTAMP(3);

-- Everyone who signed up before this is approved.
UPDATE "User" SET "approvedAt" = "createdAt";
