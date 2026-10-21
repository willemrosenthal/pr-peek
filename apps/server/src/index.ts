import { resolve } from "node:path";
import { promisify } from "node:util";
import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { checkDb, createDb, createPool } from "./db";
import { createLogger } from "./logger";
import { sessionMiddleware } from "./session";
import { onShutdown } from "./shutdown";

const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config);
const db = createDb(pool);
const PgStore = connectPgSimple(session);

const app = createApp({
  logger,
  version: config.RENDER_GIT_COMMIT ?? "dev",
  checkDb: () => checkDb(db),
  appUrl: config.APP_URL,
  session: sessionMiddleware({
    secret: config.SESSION_SECRET,
    secure: config.NODE_ENV === "production",
    // The table comes from a Prisma migration.
    store: new PgStore({ pool, tableName: "session" }),
  }),
  // Same depth from src/ (tsx in dev) and dist/ (built), so this works for both.
  webDir: resolve(import.meta.dirname, "../../web/dist"),
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "server listening");
});

onShutdown(logger, async () => {
  await promisify(server.close.bind(server))();
  await db.$disconnect();
  await pool.end();
});
