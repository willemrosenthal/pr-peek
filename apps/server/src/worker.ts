import { loadConfig } from "./config";
import { createDb, createPool } from "./db";
import { getOctokit } from "./github/client";
import { createGitHubOAuth } from "./github/oauth";
import {
  createBoss,
  createQueues,
  NOTIFY_ITEM,
  queueSync,
  REMINDER_DISPATCH,
  SUMMARY_DISPATCH,
  SYNC_DISPATCH,
  SYNC_USER,
} from "./jobs";
import { createLogger } from "./logger";
import { notifyItem } from "./notify";
import { vapidFrom, webPushSender } from "./push";
import { sendDueReminders } from "./reminders";
import { onShutdown } from "./shutdown";
import { sendDueSummaries } from "./summary";
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

const vapid = vapidFrom(config);
const send = vapid ? webPushSender(vapid) : null;
await boss.work<{ itemId: string }>(NOTIFY_ITEM, async ([job]) => {
  if (!job) return;
  const { itemId } = job.data;
  const outcome = await notifyItem({ db, send, logger }, itemId);
  logger.info({ itemId, outcome }, "notify item");
});

await boss.schedule(SUMMARY_DISPATCH, "*/15 * * * *");
await boss.work(SUMMARY_DISPATCH, async () => {
  const sent = await sendDueSummaries({ db, send, logger }, new Date());
  if (sent > 0) logger.info({ sent }, "morning summaries sent");
});

await boss.schedule(REMINDER_DISPATCH, "*/5 * * * *");
await boss.work(REMINDER_DISPATCH, async () => {
  const sent = await sendDueReminders({ db, send, logger }, new Date());
  if (sent > 0) logger.info({ sent }, "reminders sent");
});

logger.info("worker started");

onShutdown(logger, async () => {
  await boss.stop({ graceful: true });
  await db.$disconnect();
  await pool.end();
});
