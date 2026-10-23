-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN     "onMac" BOOLEAN;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "desktopSeenAt" TIMESTAMP(3);
