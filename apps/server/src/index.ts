import { resolve } from "node:path";
import { promisify } from "node:util";
import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { checkDb, createDb, createPool } from "./db";
import { createGitHubOAuth } from "./github/oauth";
import { createLogger } from "./logger";
import { getOctokit } from "./github/client";
import { authRouter } from "./routes/auth";
import { reposRouter } from "./routes/repos";
import { sessionMiddleware } from "./session";
import { onShutdown } from "./shutdown";

const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config);
const db = createDb(pool);
const oauth = createGitHubOAuth({
  clientId: config.GITHUB_CLIENT_ID,
  clientSecret: config.GITHUB_CLIENT_SECRET,
});
const PgStore = connectPgSimple(session);
// The table comes from a Prisma migration.
const sessionStore = new PgStore({ pool, tableName: "session" });

const app = createApp({
  logger,
  version: config.RENDER_GIT_COMMIT ?? "dev",
  checkDb: () => checkDb(db),
  appUrl: config.APP_URL,
  session: sessionMiddleware({
    secret: config.SESSION_SECRET,
    secure: config.NODE_ENV === "production",
    store: sessionStore,
  }),
  routers: [
    authRouter({
      db,
      oauth,
      key: config.TOKEN_ENC_KEY,
      appUrl: config.APP_URL,
    }),
    reposRouter({
      db,
      github: (userId) =>
        getOctokit({ db, oauth, key: config.TOKEN_ENC_KEY }, userId),
    }),
  ],
  // Same depth from src/ (tsx in dev) and dist/ (built), so this works for both.
  webDir: resolve(import.meta.dirname, "../../web/dist"),
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "server listening");
});

onShutdown(logger, async () => {
  await promisify(server.close.bind(server))();
  await db.$disconnect();
  // Stops the store's expired-session cleanup timer before the pool closes.
  sessionStore.close();
  await pool.end();
});
