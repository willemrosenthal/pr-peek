-- The last quiet hours and summary time set, kept while they're turned off, so turning
-- them back on brings back the user's own times. Added columns only, so the live code
-- keeps working while this deploys.
ALTER TABLE "UserSettings" ADD COLUMN "keptQuietStart" TEXT,
ADD COLUMN "keptQuietEnd" TEXT,
ADD COLUMN "keptDigestTime" TEXT;

-- Times that are on now are the ones to keep.
UPDATE "UserSettings"
SET "keptQuietStart" = "quietStart", "keptQuietEnd" = "quietEnd"
WHERE "quietStart" IS NOT NULL AND "quietEnd" IS NOT NULL;

UPDATE "UserSettings"
SET "keptDigestTime" = "digestTime"
WHERE "digestTime" IS NOT NULL;
