import type { Db } from "./db";
import type { User } from "./generated/prisma/client";
import { encryptTokens } from "./github/tokens";
import { defaultRuleSettings } from "./items";
import type { GitHubTokens, GitHubUser } from "./github/oauth";
import { SYNC_TIMING } from "./sync-timing";

const MINUTE_MS = 60 * 1000;

// Records that the user is using the app, at most every few minutes, so it isn't a write
// on every request. Returns the user's sync state if it saved, or null if it was saved
// recently.
export async function markActive(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<Pick<User, "lastSyncedAt" | "syncError" | "syncRetryAt"> | null> {
  const savedBefore = new Date(
    now.getTime() - SYNC_TIMING.activeSaveEveryMinutes * MINUTE_MS,
  );
  const { count } = await db.user.updateMany({
    where: { id: userId, lastActiveAt: { lt: savedBefore } },
    data: { lastActiveAt: now },
  });
  if (count === 0) return null;
  return db.user.findUnique({
    where: { id: userId },
    select: { lastSyncedAt: true, syncError: true, syncRetryAt: true },
  });
}

// Creates or updates the user after they sign in with GitHub. Never touches their
// personal access token.
export async function upsertGitHubUser(
  db: Db,
  githubUser: GitHubUser,
  tokens: GitHubTokens,
  key: Buffer,
): Promise<{ user: User; isNew: boolean }> {
  const profile = {
    login: githubUser.login,
    name: githubUser.name,
    avatarUrl: githubUser.avatarUrl,
    lastActiveAt: new Date(),
  };
  const tokenFields = encryptTokens(tokens, key);

  const existing = await db.user.findUnique({
    where: { githubId: githubUser.id },
    select: { id: true, syncError: true },
  });
  // Signing in fixes a revoked sign in, so sync right away. A broken personal access
  // token still needs a new one.
  const clearErrors = existing?.syncError !== "token" && {
    syncError: null,
    syncFailures: 0,
    syncRetryAt: null,
  };

  const user = await db.user.upsert({
    where: { githubId: githubUser.id },
    update: { ...profile, ...tokenFields, ...clearErrors },
    create: {
      githubId: githubUser.id,
      ...profile,
      ...tokenFields,
      settings: { create: {} },
      ruleSettings: { create: defaultRuleSettings() },
    },
  });

  return { user, isNew: !existing };
}
