-- What a review on your PR said, for the iPhone app's notification tiles (plan 12). A new
-- optional column, so the live code keeps working while this deploys.
-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "reviewState" TEXT;

