import type { Db } from "./db";
import type { AuthMethod, User } from "./generated/prisma/client";
import { encryptTokens } from "./github/tokens";
import { defaultRuleSettings } from "./items";
import type { GitHubTokens, GitHubUser } from "./github/oauth";

// How often to save `lastActiveAt`, so it isn't a write on every request.
const ACTIVE_SAVE_EVERY_MS = 60 * 60 * 1000;

// Records that the user opened the app.
export async function markActive(
  db: Db,
  user: Pick<User, "id" | "lastActiveAt">,
  now = new Date(),
): Promise<void> {
  if (now.getTime() - user.lastActiveAt.getTime() < ACTIVE_SAVE_EVERY_MS) {
    return;
  }
  await db.user.update({
    where: { id: user.id },
    data: { lastActiveAt: now },
  });
}

// Creates or updates the user after they sign in with GitHub or a personal access token.
export async function upsertGitHubUser(
  db: Db,
  githubUser: GitHubUser,
  tokens: GitHubTokens,
  key: Buffer,
  authMethod: AuthMethod,
): Promise<{ user: User; isNew: boolean }> {
  const profile = {
    login: githubUser.login,
    name: githubUser.name,
    avatarUrl: githubUser.avatarUrl,
    authMethod,
    lastActiveAt: new Date(),
  };
  const tokenFields = encryptTokens(tokens, key);

  const existing = await db.user.findUnique({
    where: { githubId: githubUser.id },
    select: { id: true },
  });

  const user = await db.user.upsert({
    where: { githubId: githubUser.id },
    // Signing in again fixes a revoked token, so clear the error and sync right away.
    update: {
      ...profile,
      ...tokenFields,
      syncError: null,
      syncFailures: 0,
      syncRetryAt: null,
    },
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
