-- AlterTable
ALTER TABLE "WatchedRepo" ADD COLUMN     "colorOn" BOOLEAN NOT NULL DEFAULT false;

-- Repos colored before this keep their color on.
UPDATE "WatchedRepo" SET "colorOn" = true WHERE "color" IS NOT NULL;
