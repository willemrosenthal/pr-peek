import { createHash } from "node:crypto";
import type { GitHubTokenDto } from "@pr-peek/core";
import type { Config } from "../config";
import { decrypt, encrypt } from "../crypto";
import type { Db } from "../db";
import type {
  GitHubToken,
  Prisma,
  SyncError,
  TokenKind,
} from "../generated/prisma/client";
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

// Locks the user's row until the transaction ends, so two token writes never cross.
const lockUser = (tx: Prisma.TransactionClient, userId: string) =>
  tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

// The keys to read tokens with: the current one, then the previous.
const keysOf = (keys: TokenKeys) =>
  keys.previousKey ? [keys.key, keys.previousKey] : [keys.key];

// Sync errors that stop syncs until the user acts. "reauth": sign in with GitHub again.
// "token": add a new personal access token.
export type StopReason = Exclude<SyncError, "failed">;
export const STOP_REASONS: StopReason[] = ["reauth", "token"];

// GitHub stopped accepting the user's token: it expired, or they revoked it. `reason`
// says which kind, and `tokenId` which personal access token, if it was one.
// In a request it becomes a 401 with code "reauth" or "token_invalid".
export class NeedsReauthError extends HttpError {
  constructor(
    readonly userId: string,
    readonly reason: StopReason = "reauth",
    readonly tokenId: string | null = null,
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

// SHA-256 of a token, to spot the same one added twice. It can't be turned back into
// the token.
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const tokenKind = (token: string): TokenKind =>
  token.startsWith("github_pat_") ? "fine_grained" : "classic";

// The GitHubToken columns for a personal access token, ready to save.
export function encryptPersonalToken(
  token: { token: string; expiresAt: Date | null; scopes: string[] },
  key: Buffer,
) {
  return {
    tokenEnc: encrypt(token.token, key),
    tokenHash: hashToken(token.token),
    kind: tokenKind(token.token),
    scopes: token.scopes,
    expiresAt: token.expiresAt,
  };
}

// The user's newest personal access token, or null. Until plan 20's settings page, a
// user has at most one: saving a token replaces the last.
export const newestToken = (db: Db, userId: string) =>
  db.gitHubToken.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

// Which token a GitHub client uses. With none, the newest personal access token, else the
// sign in. `owner`: the token that reaches that user or org (see pickToken). `tokenId`:
// that personal access token, or the sign in when null.
export type TokenChoice = { owner: string } | { tokenId: string | null };

type PickableToken = Pick<
  GitHubToken,
  "id" | "kind" | "owners" | "status" | "createdAt"
>;

// The token for an owner's repos: the newest working token that reaches it. A classic
// token reaches every owner. Null means the GitHub sign in. Logins ignore case on GitHub.
export function pickToken(
  tokens: PickableToken[],
  owner: string,
): string | null {
  const wanted = owner.toLowerCase();
  const reaches = (token: PickableToken) =>
    token.kind === "classic" ||
    token.owners.some((o) => o.toLowerCase() === wanted);
  const [newest] = tokens
    .filter((token) => token.status === "working" && reaches(token))
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return newest?.id ?? null;
}

async function chosenToken(
  db: Db,
  userId: string,
  choice: TokenChoice | undefined,
): Promise<GitHubToken | null> {
  if (!choice) return newestToken(db, userId);
  if ("owner" in choice) {
    const tokens = await db.gitHubToken.findMany({ where: { userId } });
    const id = pickToken(tokens, choice.owner);
    return tokens.find((token) => token.id === id) ?? null;
  }
  return choice.tokenId
    ? db.gitHubToken.findFirst({ where: { id: choice.tokenId, userId } })
    : null;
}

// Saves the user's personal access token in place of any they had. Also writes the old
// User columns, which the running version reads during a deploy.
export function savePersonalToken(
  db: Db,
  userId: string,
  token: ReturnType<typeof encryptPersonalToken>,
  userData: Prisma.UserUpdateInput = {},
): Promise<GitHubToken> {
  return db.$transaction(async (tx) => {
    await lockUser(tx, userId);
    await tx.gitHubToken.deleteMany({ where: { userId } });
    const saved = await tx.gitHubToken.create({
      data: { userId, name: "Personal access token", ...token },
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        ...userData,
        patEnc: token.tokenEnc,
        patExpiresAt: token.expiresAt,
        patScopes: token.scopes,
      },
    });
    return saved;
  });
}

// Removes the user's personal access tokens, and the old User columns.
export async function removePersonalTokens(
  db: Db,
  userId: string,
  userData: Prisma.UserUpdateInput = {},
): Promise<void> {
  // Locked like a save, so one running at the same time can't leave the two apart.
  await db.$transaction(async (tx) => {
    await lockUser(tx, userId);
    await tx.gitHubToken.deleteMany({ where: { userId } });
    await tx.user.update({
      where: { id: userId },
      data: { ...userData, patEnc: null, patExpiresAt: null, patScopes: [] },
    });
  });
}

// What the app shows about the user's personal access token. Null when they have none.
export function personalTokenDto(
  token: Pick<GitHubToken, "expiresAt" | "scopes"> | null,
  syncError: SyncError | null,
): GitHubTokenDto | null {
  if (!token) return null;
  return {
    expiresAt: token.expiresAt?.toISOString() ?? null,
    scopes: token.scopes,
    invalid: syncError === "token",
  };
}

// GitHub rejected a token. Marks that personal access token stopped (`tokenId`; null for
// the sign in, or when it's not known). Syncs stop only when no personal access token
// works: "token" if the user has any, else "reauth". Returns why syncs stopped, or null.
export async function markRejected(
  db: Db,
  userId: string,
  tokenId: string | null,
): Promise<StopReason | null> {
  if (tokenId) {
    await db.gitHubToken.updateMany({
      where: { id: tokenId, userId, status: "working" },
      data: { status: "stopped", stoppedAt: new Date() },
    });
  }
  const tokens = await db.gitHubToken.findMany({
    where: { userId },
    select: { status: true },
  });
  const reason: StopReason | null = tokens.some((t) => t.status === "working")
    ? null
    : tokens.length > 0
      ? "token"
      : "reauth";
  if (reason) {
    await db.user.updateMany({
      where: { id: userId },
      data: { syncError: reason },
    });
  }
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

// A working token, and which personal access token it is (null for the sign in). The
// sign in token is refreshed first if it's about to expire. See TokenChoice for `choice`.
export async function getAccessToken(
  deps: TokenDeps,
  userId: string,
  choice?: TokenChoice,
): Promise<{ token: string; tokenId: string | null }> {
  const now = (deps.now ?? (() => new Date()))();
  const expiresSoon = (expiresAt: Date | null) =>
    expiresAt !== null &&
    expiresAt.getTime() - now.getTime() <= REFRESH_MARGIN_MS;
  // The decrypted access token, or null if it's missing or about to expire.
  const freshToken = (t: StoredTokens): string | null =>
    t.accessTokenEnc && !expiresSoon(t.accessTokenExpiresAt)
      ? decrypt(t.accessTokenEnc, keysOf(deps))
      : null;

  const personal = await chosenToken(deps.db, userId, choice);
  // A chosen personal access token never falls back to the sign in token. It may not
  // see the user's org repos.
  if (personal) {
    if (expiresSoon(personal.expiresAt)) {
      await markRejected(deps.db, userId, personal.id);
      throw new NeedsReauthError(userId, "token", personal.id);
    }
    const token = decrypt(personal.tokenEnc, keysOf(deps));
    // Copied from the User row, where SQL couldn't read it. Fill in what needed it.
    if (personal.tokenHash === null) {
      await deps.db.gitHubToken.updateMany({
        where: { id: personal.id, tokenHash: null },
        data: { tokenHash: hashToken(token), kind: tokenKind(token) },
      });
    }
    return { token, tokenId: personal.id };
  }
  const stored = await deps.db.user.findUniqueOrThrow({
    where: { id: userId },
    select: TOKEN_FIELDS,
  });
  const current = freshToken(stored);
  if (current) return { token: current, tokenId: null };

  // Lock the user's row so the web service and worker never refresh at the same time.
  // GitHub only accepts each refresh token once, so a second refresh would fail.
  const result = await deps.db.$transaction(
    async (tx) => {
      await lockUser(tx, userId);
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
    await markRejected(deps.db, userId, null);
    throw new NeedsReauthError(userId);
  }
  return { token: result.token, tokenId: null };
}

// Encrypts every stored token again with `key`, after a key change. Tokens the previous
// key encrypted read with either. Returns how many users it saved.
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
        { githubTokens: { some: {} } },
      ],
    },
    select: { id: true },
  });
  let saved = 0;
  for (const { id } of users) {
    // Locked like a refresh, so a token refreshed meanwhile is never overwritten with
    // the old one. GitHub only accepts each refresh token once.
    await db.$transaction(async (tx) => {
      await lockUser(tx, id);
      const user = await tx.user.findUnique({
        where: { id },
        select: { accessTokenEnc: true, refreshTokenEnc: true, patEnc: true },
      });
      // Deleted meanwhile.
      if (!user) return;
      const tokens = await tx.gitHubToken.findMany({
        where: { userId: id },
        select: { id: true, tokenEnc: true },
      });
      // patEnc keeps the same text as its token in the table, so the two still match.
      let patEnc = again(user.patEnc);
      for (const token of tokens) {
        const tokenEnc = again(token.tokenEnc)!;
        if (token.tokenEnc === user.patEnc) patEnc = tokenEnc;
        await tx.gitHubToken.update({
          where: { id: token.id },
          data: { tokenEnc },
        });
      }
      await tx.user.update({
        where: { id },
        data: {
          accessTokenEnc: again(user.accessTokenEnc),
          refreshTokenEnc: again(user.refreshTokenEnc),
          patEnc,
        },
      });
      saved++;
    });
  }
  return saved;
}
