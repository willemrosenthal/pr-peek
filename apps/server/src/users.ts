import type { Db } from "./db";
import type { User } from "./generated/prisma/client";
import { encryptTokens } from "./github/tokens";
import type { GitHubTokens, GitHubUser } from "./github/oauth";

// Creates or updates the user after they sign in with GitHub.
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
  };
  const tokenFields = encryptTokens(tokens, key);

  const existing = await db.user.findUnique({
    where: { githubId: githubUser.id },
    select: { id: true },
  });

  const user = await db.user.upsert({
    where: { githubId: githubUser.id },
    // Signing in again fixes a revoked token, so clear the reauth flag.
    update: { ...profile, ...tokenFields, syncError: null },
    create: {
      githubId: githubUser.id,
      ...profile,
      ...tokenFields,
      settings: { create: {} },
    },
  });

  return { user, isNew: !existing };
}
