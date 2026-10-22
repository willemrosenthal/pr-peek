import { loadConfig } from "./config";
import { createDb, createPool } from "./db";
import { getOctokit } from "./github/client";
import { createGitHubOAuth } from "./github/oauth";
import {
  createBoss,
  createQueues,
  NOTIFY_ITEM,
  queueSync,
  SYNC_DISPATCH,
  SYNC_USER,
} from "./jobs";
import { createLogger } from "./logger";
import { onShutdown } from "./shutdown";
import { dueUserIds, runSync } from "./sync-schedule";

// Syncs running at once, so one slow user doesn't hold up everyone. Each holds a database
// connection during its save, so keep this below DB_POOL_MAX to leave room for pg-boss.
const SYNC_CONCURRENCY = 3;

const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config);
const db = createDb(pool);
const oauth = createGitHubOAuth({
  clientId: config.GITHUB_CLIENT_ID,
  clientSecret: config.GITHUB_CLIENT_SECRET,
});
const boss = createBoss(pool, { worker: true });

boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

await boss.start();

await boss.createQueue("heartbeat");
await boss.schedule("heartbeat", "* * * * *");
await boss.work("heartbeat", () => {
  logger.info("heartbeat");
  return Promise.resolve();
});

await createQueues(boss);

await boss.schedule(SYNC_DISPATCH, "* * * * *");
await boss.work(SYNC_DISPATCH, async () => {
  const userIds = await dueUserIds(db, new Date());
  if (userIds.length === 0) return;
  const queued = await Promise.all(
    userIds.map((userId) => queueSync(boss, userId)),
  );
  logger.info(
    { due: userIds.length, queued: queued.filter(Boolean).length },
    "sync dispatch",
  );
});

await boss.work<{ userId: string }>(
  SYNC_USER,
  { localConcurrency: SYNC_CONCURRENCY },
  async ([job]) => {
    if (!job) return;
    await runSync(
      {
        db,
        logger,
        github: (userId) =>
          getOctokit({ db, oauth, key: config.TOKEN_ENC_KEY }, userId),
        notifyItems: async (itemIds) => {
          await boss.insert(
            NOTIFY_ITEM,
            itemIds.map((itemId) => ({ data: { itemId } })),
          );
        },
      },
      job.data.userId,
    );
  },
);

// Plan 08 sends push notifications here. For now it only logs.
await boss.work<{ itemId: string }>(NOTIFY_ITEM, ([job]) => {
  if (job) logger.info({ itemId: job.data.itemId }, "notify item");
  return Promise.resolve();
});

logger.info("worker started");

onShutdown(logger, async () => {
  await boss.stop({ graceful: true });
  await db.$disconnect();
  await pool.end();
});
