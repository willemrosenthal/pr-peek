// Runs one sync for a user, by GitHub login. For trying the sync before the worker runs it.
// Usage: pnpm --filter @pr-peek/server sync:once <login>
import { loadConfig } from "../config";
import { createDb, createPool } from "../db";
import { getOctokit } from "../github/client";
import { createGitHubOAuth } from "../github/oauth";
import { createLogger } from "../logger";
import { syncUser } from "../sync";

const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config);
const db = createDb(pool);
const oauth = createGitHubOAuth({
  clientId: config.GITHUB_CLIENT_ID,
  clientSecret: config.GITHUB_CLIENT_SECRET,
});

try {
  const login = process.argv[2];
  const user = login && (await db.user.findFirst({ where: { login } }));
  if (!user) {
    logger.error({ login }, "No user with that login. Sign in first.");
    process.exitCode = 1;
  } else {
    const started = Date.now();
    const result = await syncUser(
      {
        db,
        github: (userId) =>
          getOctokit(
            {
              db,
              oauth,
              key: config.TOKEN_ENC_KEY,
              previousKey: config.TOKEN_ENC_KEY_PREVIOUS,
            },
            userId,
          ),
      },
      user.id,
    );
    logger.info({ ...result, ms: Date.now() - started }, "sync done");
  }
} finally {
  await db.$disconnect();
  await pool.end();
}
