import type { GitHubTokenDto } from "@pr-peek/core";
import type { Config } from "../config";
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
  // The key before `key`, while changing it (TOKEN_ENC_KEY_PREVIOUS).
  previousKey?: Buffer | undefined;
  now?: () => Date;
}

type TokenKeys = Pick<TokenDeps, "key" | "previousKey">;

export const tokenKeys = (
  config: Pick<Config, "TOKEN_ENC_KEY" | "TOKEN_ENC_KEY_PREVIOUS">,
): TokenKeys => ({
  key: config.TOKEN_ENC_KEY,
  previousKey: config.TOKEN_ENC_KEY_PREVIOUS,
});

// The keys to read tokens with: the current one, then the previous.
const keysOf = (keys: TokenKeys) =>
  keys.previousKey ? [keys.key, keys.previousKey] : [keys.key];

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
  await db.user.updateMany({
    where: { id: userId },
    data: { syncError: reason },
  });
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
      ? decrypt(t.accessTokenEnc, keysOf(deps))
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
    return decrypt(stored.patEnc, keysOf(deps));
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
          decrypt(refreshTokenEnc, keysOf(deps)),
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

// Encrypts every stored token again with `key`, after a key change. Tokens the previous
// key encrypted read with either. Returns how many users it changed.
export async function reencryptTokens(
  db: Db,
  keys: TokenKeys,
): Promise<number> {
  const again = (blob: string | null) =>
    blob === null ? null : encrypt(decrypt(blob, keysOf(keys)), keys.key);
  const users = await db.user.findMany({
    where: {
      OR: [
        { accessTokenEnc: { not: null } },
        { refreshTokenEnc: { not: null } },
        { patEnc: { not: null } },
      ],
    },
    select: { id: true },
  });
  let changed = 0;
  for (const { id } of users) {
    // Locked like a refresh, so a token refreshed meanwhile is never overwritten with
    // the old one. GitHub only accepts each refresh token once.
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id },
        select: { accessTokenEnc: true, refreshTokenEnc: true, patEnc: true },
      });
      // Deleted meanwhile.
      if (!user) return;
      await tx.user.update({
        where: { id },
        data: {
          accessTokenEnc: again(user.accessTokenEnc),
          refreshTokenEnc: again(user.refreshTokenEnc),
          patEnc: again(user.patEnc),
        },
      });
      changed++;
    });
  }
  return changed;
}
