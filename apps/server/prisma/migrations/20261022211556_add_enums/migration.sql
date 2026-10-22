-- Hand edited: converts each column in place, so no data is lost. Values the app never
-- writes are fixed first, so the casts can't fail.

-- CreateEnum
CREATE TYPE "SyncError" AS ENUM ('reauth', 'token', 'failed');

-- CreateEnum
CREATE TYPE "PrState" AS ENUM ('open', 'merged', 'closed', 'gone', 'unwatched');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('low', 'normal', 'high');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('list', 'push');

-- AlterTable
UPDATE "PullRequest" SET "state" = 'gone'
WHERE "state" NOT IN ('open', 'merged', 'closed', 'gone', 'unwatched');
ALTER TABLE "PullRequest"
ALTER COLUMN "state" TYPE "PrState" USING "state"::"PrState";

-- AlterTable
UPDATE "PushSubscription" SET "minSeverity" = 'low'
WHERE "minSeverity" NOT IN ('low', 'normal', 'high');
ALTER TABLE "PushSubscription" DROP COLUMN "platform",
ALTER COLUMN "minSeverity" DROP DEFAULT,
ALTER COLUMN "minSeverity" TYPE "Severity" USING "minSeverity"::"Severity",
ALTER COLUMN "minSeverity" SET DEFAULT 'low';

-- AlterTable
UPDATE "RuleSetting" SET "severity" = 'normal'
WHERE "severity" NOT IN ('low', 'normal', 'high');
UPDATE "RuleSetting" SET "channels" = ARRAY['list']
WHERE NOT "channels" <@ ARRAY['list', 'push'];
ALTER TABLE "RuleSetting"
ALTER COLUMN "severity" TYPE "Severity" USING "severity"::"Severity",
ALTER COLUMN "channels" TYPE "Channel"[] USING "channels"::"Channel"[];

-- AlterTable
UPDATE "User" SET "syncError" = 'failed'
WHERE "syncError" NOT IN ('reauth', 'token', 'failed');
ALTER TABLE "User"
ALTER COLUMN "syncError" TYPE "SyncError" USING "syncError"::"SyncError";
