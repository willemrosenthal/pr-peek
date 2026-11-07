-- Plan 20: personal access tokens move out of the User row, one row per token.

-- CreateEnum
CREATE TYPE "TokenKind" AS ENUM ('classic', 'fine_grained');

-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('working', 'stopped');

-- CreateTable
CREATE TABLE "GitHubToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenEnc" TEXT NOT NULL,
    "tokenHash" TEXT,
    "kind" "TokenKind",
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "owners" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownersCheckedAt" TIMESTAMP(3),
    "status" "TokenStatus" NOT NULL DEFAULT 'working',
    "stoppedAt" TIMESTAMP(3),
    "expiryRemindedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitHubToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GitHubToken_userId_tokenHash_key" ON "GitHubToken"("userId", "tokenHash");

-- AddForeignKey
ALTER TABLE "GitHubToken" ADD CONSTRAINT "GitHubToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy each user's token. The encrypted text copies as is. SQL can't decrypt it, so the
-- hash and kind wait for the token's next read. The User columns stay for one release
-- (see schema.prisma).
INSERT INTO "GitHubToken" ("id", "userId", "name", "tokenEnc", "scopes", "expiresAt", "status", "stoppedAt")
SELECT
  gen_random_uuid()::text,
  "id",
  'Personal access token',
  "patEnc",
  "patScopes",
  "patExpiresAt",
  CASE WHEN "syncError" = 'token' THEN 'stopped' ELSE 'working' END::"TokenStatus",
  CASE WHEN "syncError" = 'token' THEN CURRENT_TIMESTAMP END
FROM "User"
WHERE "patEnc" IS NOT NULL;
