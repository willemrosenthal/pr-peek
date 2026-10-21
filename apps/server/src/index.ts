import { resolve } from "node:path";
import { promisify } from "node:util";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { checkDb, createDb } from "./db";
import { createLogger } from "./logger";
import { onShutdown } from "./shutdown";

const config = loadConfig();
const logger = createLogger(config);
const db = createDb(config.DATABASE_URL);

const app = createApp({
  logger,
  version: config.RENDER_GIT_COMMIT ?? "dev",
  checkDb: () => checkDb(db),
  // Same depth from src/ (tsx in dev) and dist/ (built), so this works for both.
  webDir: resolve(import.meta.dirname, "../../web/dist"),
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "server listening");
});

onShutdown(logger, async () => {
  await promisify(server.close.bind(server))();
  await db.$disconnect();
});
