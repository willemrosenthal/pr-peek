-- AlterTable
ALTER TABLE "User" ADD COLUMN     "patEnc" TEXT,
ADD COLUMN     "patExpiresAt" TIMESTAMP(3),
ADD COLUMN     "patScopes" TEXT[];

-- Moves tokens pasted at sign in into the new columns. The sign in token columns are
-- left empty, so these users sign in with GitHub next time.
UPDATE "User"
SET "patEnc" = "accessTokenEnc",
    "patExpiresAt" = "accessTokenExpiresAt",
    "patScopes" = "tokenScopes",
    "accessTokenEnc" = NULL,
    "accessTokenExpiresAt" = NULL,
    "tokenScopes" = ARRAY[]::TEXT[]
WHERE "authMethod" = 'pat';
