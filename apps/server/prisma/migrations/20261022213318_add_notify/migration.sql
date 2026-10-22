-- Hand edited: converts the NotificationLog columns in place, like add_enums. Nothing has
-- written to the table yet, so the casts can't fail.

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sent', 'failed');

-- AlterTable
ALTER TABLE "NotificationLog"
ALTER COLUMN "channel" TYPE "Channel" USING "channel"::"Channel",
ALTER COLUMN "status" TYPE "NotificationStatus" USING "status"::"NotificationStatus",
ALTER COLUMN "status" SET DEFAULT 'pending';

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN "highBreaksQuiet" BOOLEAN NOT NULL DEFAULT false;
