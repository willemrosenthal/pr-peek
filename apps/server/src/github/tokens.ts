import { createHash } from "node:crypto";
import { RequestError } from "octokit";
import { MAX_TOKENS, type GitHubTokenDto, type TokenDto } from "@pr-peek/core";
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

// GitHub stopped accepting a token: while making the client, or answering a request.
export const isRejection = (err: unknown) =>
  err instanceof NeedsReauthError ||
  (err instanceof RequestError && err.status === 401);

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

// Which token a GitHub client uses. With none, the newest working personal access token,
// else the newest stopped one (so its error shows), else the sign in. `owner`: the token
// that reaches that user or org (see pickToken). `tokenId`: that personal access token,
// or the sign in when null or when the token is gone.
export type TokenChoice = { owner: string } | { tokenId: string | null };

export type PickableToken = Pick<
  GitHubToken,
  "id" | "kind" | "owners" | "status" | "createdAt"
>;

// What picking and using a token reads. The rest stays in the database.
const TOKEN_ROW = {
  id: true,
  tokenEnc: true,
  tokenHash: true,
  expiresAt: true,
  kind: true,
  owners: true,
  status: true,
  createdAt: true,
} as const;

// Logins ignore case on GitHub.
export const sameLogin = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();

// Whether a token reaches an owner's private repos. A classic token reaches every owner.
export const reachesOwner = (
  token: Pick<GitHubToken, "kind" | "owners">,
  owner: string,
) => token.kind === "classic" || token.owners.some((o) => sameLogin(o, owner));

// The token for an owner's repos: the newest working token that reaches it. Null means
// the GitHub sign in.
export function pickToken(
  tokens: PickableToken[],
  owner: string,
): string | null {
  const [newest] = tokens
    .filter((token) => token.status === "working" && reachesOwner(token, owner))
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return newest?.id ?? null;
}

// The personal access token for no choice or an owner (see TokenChoice), from all the
// user's tokens in one query.
async function chosenToken(
  db: Db,
  userId: string,
  choice: { owner: string } | undefined,
) {
  const tokens = await db.gitHubToken.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: TOKEN_ROW,
  });
  if (choice) {
    const id = pickToken(tokens, choice.owner);
    return tokens.find((token) => token.id === id) ?? null;
  }
  // The newest working token, else the newest stopped one, so its error shows.
  return (
    tokens.find((token) => token.status === "working") ?? tokens[0] ?? null
  );
}

// Saves the user's personal access token in place of any they had. For the old
// /github-token routes, until plan 20's settings page replaces them.
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
    await tx.user.update({ where: { id: userId }, data: userData });
    return saved;
  });
}

// Removes the user's personal access tokens.
export async function removePersonalTokens(
  db: Db,
  userId: string,
  userData: Prisma.UserUpdateInput = {},
): Promise<void> {
  await db.$transaction([
    db.gitHubToken.deleteMany({ where: { userId } }),
    db.user.update({ where: { id: userId }, data: userData }),
  ]);
}

// What the API shows about a token. Never the token itself.
const DTO_FIELDS = {
  id: true,
  name: true,
  kind: true,
  owners: true,
  scopes: true,
  expiresAt: true,
  status: true,
  createdAt: true,
} as const;

type TokenRow = Prisma.GitHubTokenGetPayload<{ select: typeof DTO_FIELDS }>;

export const tokenDto = (row: TokenRow): TokenDto => ({
  ...row,
  expiresAt: row.expiresAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

// The user's personal access tokens, oldest first.
export const listTokens = (db: Db, userId: string) =>
  db.gitHubToken.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: DTO_FIELDS,
  });

// A checked token, ready to save: its columns (see encryptPersonalToken) and owners.
export type CheckedPersonalToken = ReturnType<typeof encryptPersonalToken> & {
  owners: string[];
};

export const alreadyAdded = () =>
  new HttpError(409, "already_added", "You've already added this token.");
const notYours = () =>
  new HttpError(404, "not_found", "That token isn't one of yours.");

// A new token may fix stopped or failing syncs, so the next dispatch picks the user up.
const RESTART_SYNCS = {
  syncError: null,
  syncFailures: 0,
  syncRetryAt: null,
} as const;

// Adds a token, or replaces the one `replaceId` names in one step, so its owners never
// fall back to the sign in. Replacing works at the cap, and keeps the name unless a new
// one is given. Locked, so two saves at once can't pass the cap or add the same token.
export function saveToken(
  db: Db,
  userId: string,
  token: CheckedPersonalToken,
  options: { name: string } | { name?: string; replaceId: string },
): Promise<TokenRow> {
  const replaceId = "replaceId" in options ? options.replaceId : null;
  return db.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const tokens = await tx.gitHubToken.findMany({
      where: { userId },
      select: { id: true, tokenHash: true },
    });
    if (replaceId && !tokens.some((t) => t.id === replaceId)) throw notYours();
    if (
      tokens.some((t) => t.tokenHash === token.tokenHash && t.id !== replaceId)
    ) {
      throw alreadyAdded();
    }
    if (!replaceId && tokens.length >= MAX_TOKENS) {
      throw new HttpError(
        409,
        "too_many",
        `You can add up to ${MAX_TOKENS} tokens. Remove one first.`,
      );
    }
    const data = {
      ...token,
      ...(options.name !== undefined && { name: options.name }),
      ownersCheckedAt: new Date(),
      status: "working" as const,
      stoppedAt: null,
      expiryRemindedAt: null,
    };
    const saved =
      "replaceId" in options
        ? await tx.gitHubToken.update({
            where: { id: options.replaceId },
            data,
            select: DTO_FIELDS,
          })
        : await tx.gitHubToken.create({
            data: { userId, ...data, name: options.name },
            select: DTO_FIELDS,
          });
    await tx.user.update({ where: { id: userId }, data: RESTART_SYNCS });
    return saved;
  });
}

// Removes one token. Its owners sync with another token or the sign in. If syncs waited
// for a new token, they start again when one still works, or none are left.
export async function removeToken(
  db: Db,
  userId: string,
  tokenId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const { count } = await tx.gitHubToken.deleteMany({
      where: { id: tokenId, userId },
    });
    if (count === 0) throw notYours();
    const left = await tx.gitHubToken.findMany({
      where: { userId },
      select: { status: true },
    });
    if (left.length === 0 || left.some((t) => t.status === "working")) {
      await tx.user.updateMany({
        where: { id: userId, syncError: "token" },
        data: { syncError: null },
      });
    }
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

  // One query for the usual case, a user with no personal access token: the sign in
  // tokens, and whether they have any.
  let stored: StoredTokens | null = null;
  let personal = null;
  if (choice && "tokenId" in choice) {
    personal = choice.tokenId
      ? await deps.db.gitHubToken.findFirst({
          where: { id: choice.tokenId, userId },
          select: TOKEN_ROW,
        })
      : null;
  } else {
    const user = await deps.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { ...TOKEN_FIELDS, _count: { select: { githubTokens: true } } },
    });
    stored = user;
    if (user._count.githubTokens > 0) {
      personal = await chosenToken(deps.db, userId, choice);
    }
  }
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
  stored ??= await deps.db.user.findUniqueOrThrow({
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
      for (const token of tokens) {
        await tx.gitHubToken.update({
          where: { id: token.id },
          data: { tokenEnc: again(token.tokenEnc)! },
        });
      }
      await tx.user.update({
        where: { id },
        data: {
          accessTokenEnc: again(user.accessTokenEnc),
          refreshTokenEnc: again(user.refreshTokenEnc),
          patEnc: again(user.patEnc),
        },
      });
      saved++;
    });
  }
  return saved;
}
