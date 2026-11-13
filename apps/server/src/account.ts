import type { Logger } from "pino";
import { getAccessToken, type TokenDeps } from "./github/tokens";

export interface AccountDeps extends TokenDeps {
  logger: Logger;
}

// Deletes a user and everything we keep on them, for "Delete my account", a withdrawn
// sign-up request, or one an admin declined. First takes back their grant of Git Buddy
// on GitHub, if their sign in still works. Then deletes their rows (the rest cascade)
// and signs them out everywhere. Personal access tokens stay on GitHub: only the user
// can delete those there. Says whether GitHub confirmed it took the grant back.
export async function deleteAccount(
  deps: AccountDeps,
  userId: string,
): Promise<{ githubRevoked: boolean }> {
  let githubRevoked = true;
  try {
    const { token } = await getAccessToken(deps, userId, { tokenId: null });
    await deps.oauth.revokeGrant(token);
  } catch (err) {
    // GitHub is down or said no, or the sign in stopped working so we can't ask. The
    // account is deleted anyway, and the user is told to revoke it on GitHub.
    githubRevoked = false;
    deps.logger.warn({ err, userId }, "couldn't revoke the GitHub grant");
  }
  await deps.db.user.deleteMany({ where: { id: userId } });
  await deps.db
    .$executeRaw`DELETE FROM "session" WHERE "sess"->>'userId' = ${userId}`;
  return { githubRevoked };
}
