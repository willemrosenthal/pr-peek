-- Plan 20: from here, nothing writes User.patEnc, patExpiresAt, or patScopes. First make
-- the GitHubToken table match them, for a token saved or removed on the old version
-- during plan 20's first deploy. Until now every save wrote both with the same encrypted
-- text, so a plain comparison finds those. A later release drops the columns.

-- Removed on the old version: the User row has none.
DELETE FROM "GitHubToken" t
USING "User" u
WHERE t."userId" = u."id" AND u."patEnc" IS NULL;

-- Saved on the old version over one the user had: the User row has newer text. The hash,
-- kind, and owners wait for the token's next read, like after the first copy.
UPDATE "GitHubToken" t
SET "tokenEnc" = u."patEnc",
    "tokenHash" = NULL,
    "kind" = NULL,
    "scopes" = u."patScopes",
    "expiresAt" = u."patExpiresAt",
    "owners" = ARRAY[]::TEXT[],
    "ownersCheckedAt" = NULL,
    "status" = 'working',
    "stoppedAt" = NULL
FROM "User" u
WHERE t."userId" = u."id" AND u."patEnc" IS NOT NULL AND t."tokenEnc" <> u."patEnc";

-- Saved on the old version by a user who had none.
INSERT INTO "GitHubToken" ("id", "userId", "name", "tokenEnc", "scopes", "expiresAt")
SELECT gen_random_uuid()::text, u."id", 'Personal access token', u."patEnc", u."patScopes", u."patExpiresAt"
FROM "User" u
WHERE u."patEnc" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "GitHubToken" t WHERE t."userId" = u."id");
