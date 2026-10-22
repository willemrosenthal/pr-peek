-- CreateEnum
CREATE TYPE "AuthMethod" AS ENUM ('oauth', 'pat');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authMethod" "AuthMethod" NOT NULL DEFAULT 'oauth';
