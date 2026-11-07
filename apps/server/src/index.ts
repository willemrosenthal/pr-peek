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
import { tokenKeys } from "./github/tokens";
import { listenForItemChanges } from "./items-listener";
import { createBoss, createQueues, queueSync } from "./jobs";
import { vapidFrom, webPushSender } from "./push";
import { activityRouter } from "./routes/activity";
import { adminRouter } from "./routes/admin";
import { addedPrsRouter } from "./routes/added-prs";
import { authRouter } from "./routes/auth";
import { desktopRouter } from "./routes/desktop";
import { githubTokenRouter } from "./routes/github-token";
import { itemsRouter } from "./routes/items";
import { previewRouter } from "./routes/preview";
import { pushRouter } from "./routes/push";
import { reposRouter } from "./routes/repos";
import { settingsRouter } from "./routes/settings";
import { streamRouter } from "./routes/stream";
import { syncRouter } from "./routes/sync";
import { sessionMiddleware } from "./session";
import { onShutdown } from "./shutdown";
import { countPool, Usage } from "./usage";

const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config);
const usage = new Usage("web");
countPool(pool, usage);
const db = createDb(pool);
const oauth = createGitHubOAuth({
  clientId: config.GITHUB_CLIENT_ID,
  clientSecret: config.GITHUB_CLIENT_SECRET,
});
const github = (userId: string) =>
  getOctokit({ db, oauth, ...tokenKeys(config), usage }, userId);
const vapid = vapidFrom(config);
if (!vapid) logger.warn("VAPID keys not set, so push notifications are off");
const send = vapid ? webPushSender(vapid) : null;
const PgStore = connectPgSimple(session);
// The table comes from a Prisma migration.
const sessionStore = new PgStore({ pool, tableName: "session" });

// Only queues jobs. The worker runs them.
const boss = createBoss(pool, { worker: false });
boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
await boss.start();
await createQueues(boss);
const requestSync = (userId: string) => queueSync(boss, userId);

const listener = await listenForItemChanges({
  connectionString: config.DATABASE_URL,
  logger,
  usage,
});
const stopSavingUsage = usage.saveHourly(db, logger);
const streams = new AbortController();

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
    // First, so it sees every signed in request.
    activityRouter({ db, requestSync }),
    authRouter({
      db,
      oauth,
      key: config.TOKEN_ENC_KEY,
      appUrl: config.APP_URL,
      send,
      logger,
    }),
    githubTokenRouter({ db, oauth, key: config.TOKEN_ENC_KEY }),
    reposRouter({ db, github }),
    // Before itemsRouter, whose sign in check covers all of /prs.
    previewRouter({ db, github }),
    adminRouter({ db, logger, send }),
    addedPrsRouter({ db, github, requestSync }),
    itemsRouter({ db, requestSync }),
    settingsRouter({ db, requestSync }),
    syncRouter({ db, requestSync }),
    desktopRouter({ db }),
    streamRouter({ db, listener, signal: streams.signal }),
    pushRouter({
      db,
      push: vapid && send && { publicKey: vapid.publicKey, send },
    }),
  ],
  // Same depth from src/ (tsx in dev) and dist/ (built), so this works for both.
  webDir: resolve(import.meta.dirname, "../../web/dist"),
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "server listening");
});

onShutdown(logger, async () => {
  // Open streams never finish on their own, so end them first.
  streams.abort();
  await promisify(server.close.bind(server))();
  await listener.stop();
  await boss.stop({ graceful: true });
  await stopSavingUsage();
  await db.$disconnect();
  // Stops the store's expired-session cleanup timer before the pool closes.
  sessionStore.close();
  await pool.end();
});
