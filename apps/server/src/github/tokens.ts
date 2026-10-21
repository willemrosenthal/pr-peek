import { decrypt, encrypt } from "../crypto";
import type { Db } from "../db";
import { GitHubAuthError, type GitHubOAuth, type GitHubTokens } from "./oauth";

// Refresh a bit early so a token never expires partway through a sync.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface TokenDeps {
  db: Db;
  oauth: GitHubOAuth;
  key: Buffer;
  now?: () => Date;
}

// The user has to sign in again: no token, an expired refresh token, or GitHub revoked it.
export class NeedsReauthError extends Error {
  constructor(readonly userId: string) {
    super("User needs to sign in to GitHub again");
    this.name = "NeedsReauthError";
  }
}

// The User columns that hold GitHub tokens, ready to save.
export interface EncryptedTokens {
  accessTokenEnc: string;
  accessTokenExpiresAt: Date | null;
  refreshTokenEnc: string | null;
  refreshTokenExpiresAt: Date | null;
  tokenScopes: string[];
}

export function encryptTokens(
  tokens: GitHubTokens,
  key: Buffer,
): EncryptedTokens {
  return {
    accessTokenEnc: encrypt(tokens.accessToken, key),
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshTokenEnc: tokens.refreshToken && encrypt(tokens.refreshToken, key),
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    tokenScopes: tokens.scopes,
  };
}

export async function markNeedsReauth(db: Db, userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { syncError: "reauth" },
  });
}

interface StoredTokens {
  accessTokenEnc: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenEnc: string | null;
  refreshTokenExpiresAt: Date | null;
}

const TOKEN_FIELDS = {
  accessTokenEnc: true,
  accessTokenExpiresAt: true,
  refreshTokenEnc: true,
  refreshTokenExpiresAt: true,
} as const;

// Returns a working access token, refreshing it first if it's about to expire.
export async function getAccessToken(
  deps: TokenDeps,
  userId: string,
): Promise<string> {
  const now = (deps.now ?? (() => new Date()))();
  // The decrypted access token, or null if it's missing or about to expire.
  const freshToken = (t: StoredTokens): string | null => {
    if (!t.accessTokenEnc) return null;
    const expiresAt = t.accessTokenExpiresAt;
    if (expiresAt && expiresAt.getTime() - now.getTime() <= REFRESH_MARGIN_MS) {
      return null;
    }
    return decrypt(t.accessTokenEnc, deps.key);
  };

  const stored = await deps.db.user.findUniqueOrThrow({
    where: { id: userId },
    select: TOKEN_FIELDS,
  });
  const current = freshToken(stored);
  if (current) return current;

  // Lock the user's row so the web service and worker never refresh at the same time.
  // GitHub only accepts each refresh token once, so a second refresh would fail.
  const result = await deps.db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const locked = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: TOKEN_FIELDS,
      });
      // Someone else may have refreshed while we waited for the lock.
      const token = freshToken(locked);
      if (token) return { token };

      const { refreshTokenEnc, refreshTokenExpiresAt } = locked;
      if (
        !refreshTokenEnc ||
        (refreshTokenExpiresAt && refreshTokenExpiresAt <= now)
      ) {
        return { reauth: true };
      }

      try {
        const tokens = await deps.oauth.refresh(
          decrypt(refreshTokenEnc, deps.key),
        );
        await tx.user.update({
          where: { id: userId },
          data: encryptTokens(tokens, deps.key),
        });
        return { token: tokens.accessToken };
      } catch (err) {
        if (err instanceof GitHubAuthError) return { reauth: true };
        throw err;
      }
    },
    { timeout: 15_000 },
  );

  // Marked after the transaction, so it isn't rolled back with it.
  if ("reauth" in result) {
    await markNeedsReauth(deps.db, userId);
    throw new NeedsReauthError(userId);
  }
  return result.token;
}
