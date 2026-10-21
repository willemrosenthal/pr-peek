import { PgBoss } from "pg-boss";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { onShutdown } from "./shutdown";

const config = loadConfig();
const logger = createLogger(config);
const boss = new PgBoss({
  connectionString: config.DATABASE_URL,
  max: config.DB_POOL_MAX,
});

boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

await boss.start();

await boss.createQueue("heartbeat");
await boss.schedule("heartbeat", "* * * * *");
await boss.work("heartbeat", () => {
  logger.info("heartbeat");
  return Promise.resolve();
});

logger.info("worker started");

onShutdown(logger, () => boss.stop({ graceful: true }));
