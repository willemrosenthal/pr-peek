import type { GitHubTokenDto } from "@pr-peek/core";
import { decrypt, encrypt } from "../crypto";
import type { Db } from "../db";
import type { SyncError, User } from "../generated/prisma/client";
import { HttpError } from "../http-error";
import { GitHubAuthError, type GitHubOAuth, type GitHubTokens } from "./oauth";

// Refresh a bit early so a token never expires partway through a sync.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface TokenDeps {
  db: Db;
  oauth: GitHubOAuth;
  key: Buffer;
  now?: () => Date;
}

// Sync errors that stop syncs until the user acts. "reauth": sign in with GitHub again.
// "token": add a new personal access token.
export type StopReason = Exclude<SyncError, "failed">;
export const STOP_REASONS: StopReason[] = ["reauth", "token"];

// GitHub stopped accepting the user's token: it expired, or they revoked it.
// In a request it becomes a 401 with code "reauth" or "token_invalid".
export class NeedsReauthError extends HttpError {
  constructor(
    readonly userId: string,
    readonly reason: StopReason = "reauth",
  ) {
    super(
      401,
      reason === "token" ? "token_invalid" : "reauth",
      reason === "token"
        ? "Your GitHub token stopped working. Add a new one."
        : "Sign in to GitHub again",
    );
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

// The User columns for a personal access token, ready to save.
export function encryptPersonalToken(
  token: { token: string; expiresAt: Date | null; scopes: string[] },
  key: Buffer,
) {
  return {
    patEnc: encrypt(token.token, key),
    patExpiresAt: token.expiresAt,
    patScopes: token.scopes,
  };
}

// What the app shows about the user's personal access token. Null when they have none.
export function personalTokenDto(
  user: Pick<User, "patEnc" | "patExpiresAt" | "patScopes" | "syncError">,
): GitHubTokenDto | null {
  if (!user.patEnc) return null;
  return {
    expiresAt: user.patExpiresAt?.toISOString() ?? null,
    scopes: user.patScopes,
    invalid: user.syncError === "token",
  };
}

// Stops syncs until the user acts. Blames the personal access token when there is one,
// since syncs use it first.
export async function markNeedsReauth(
  db: Db,
  userId: string,
): Promise<StopReason> {
  const { patEnc } = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { patEnc: true },
  });
  const reason: StopReason = patEnc ? "token" : "reauth";
  await db.user.update({ where: { id: userId }, data: { syncError: reason } });
  return reason;
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

// Returns a working token. Prefers the user's personal access token. Otherwise uses the
// sign in token, refreshing it first if it's about to expire.
export async function getAccessToken(
  deps: TokenDeps,
  userId: string,
): Promise<string> {
  const now = (deps.now ?? (() => new Date()))();
  const expiresSoon = (expiresAt: Date | null) =>
    expiresAt !== null &&
    expiresAt.getTime() - now.getTime() <= REFRESH_MARGIN_MS;
  // The decrypted access token, or null if it's missing or about to expire.
  const freshToken = (t: StoredTokens): string | null =>
    t.accessTokenEnc && !expiresSoon(t.accessTokenExpiresAt)
      ? decrypt(t.accessTokenEnc, deps.key)
      : null;

  const stored = await deps.db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { ...TOKEN_FIELDS, patEnc: true, patExpiresAt: true },
  });
  // Never falls back to the sign in token. It may not see the user's org repos.
  if (stored.patEnc) {
    if (expiresSoon(stored.patExpiresAt)) {
      throw new NeedsReauthError(
        userId,
        await markNeedsReauth(deps.db, userId),
      );
    }
    return decrypt(stored.patEnc, deps.key);
  }
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
    throw new NeedsReauthError(userId, await markNeedsReauth(deps.db, userId));
  }
  return result.token;
}
