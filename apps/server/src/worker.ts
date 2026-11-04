import { loadConfig } from "./config";
import { createDb, createPool } from "./db";
import { getOctokit } from "./github/client";
import { createGitHubOAuth } from "./github/oauth";
import {
  createBoss,
  createQueues,
  HEARTBEAT,
  NOTIFY_ITEMS,
  NOTIFY_MERGED,
  POLL_JOBS_SECONDS,
  POLL_SCHEDULED_SECONDS,
  queueSync,
  REMINDER_DISPATCH,
  SUMMARY_DISPATCH,
  SYNC_DISPATCH,
  SYNC_USER,
} from "./jobs";
import { createLogger } from "./logger";
import { notifyItems, notifyMerged } from "./notify";
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

await createQueues(boss);

const scheduled = { pollingIntervalSeconds: POLL_SCHEDULED_SECONDS };
const jobs = { pollingIntervalSeconds: POLL_JOBS_SECONDS };

await boss.schedule(HEARTBEAT, "* * * * *");
await boss.work(HEARTBEAT, scheduled, () => {
  logger.info("heartbeat");
  return Promise.resolve();
});

await boss.schedule(SYNC_DISPATCH, "* * * * *");
await boss.work(SYNC_DISPATCH, scheduled, async () => {
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
  { ...jobs, localConcurrency: SYNC_CONCURRENCY },
  async ([job]) => {
    if (!job) return;
    await runSync(
      {
        db,
        logger,
        github: (userId) =>
          getOctokit({ db, oauth, key: config.TOKEN_ENC_KEY }, userId),
        notifyItems: async (itemIds) => {
          await boss.send(NOTIFY_ITEMS, { itemIds });
        },
        notifyMerged: async (prIds) => {
          await boss.send(NOTIFY_MERGED, { prIds });
        },
      },
      job.data.userId,
    );
  },
);

const vapid = vapidFrom(config);
const send = vapid ? webPushSender(vapid) : null;
await boss.work<{ itemIds: string[] }>(NOTIFY_ITEMS, jobs, async ([job]) => {
  if (!job) return;
  const { itemIds } = job.data;
  const outcomes = await notifyItems(
    { db, send, logger },
    itemIds.map((itemId) => ({ itemId })),
  );
  logger.info({ itemIds, outcomes }, "notify items");
});

await boss.work<{ prIds: string[] }>(NOTIFY_MERGED, jobs, async ([job]) => {
  if (!job) return;
  const { prIds } = job.data;
  const outcomes = await notifyMerged({ db, send, logger }, prIds);
  logger.info({ prIds, outcomes }, "notify merged");
});

await boss.schedule(SUMMARY_DISPATCH, "*/15 * * * *");
await boss.work(SUMMARY_DISPATCH, scheduled, async () => {
  const sent = await sendDueSummaries({ db, send, logger }, new Date());
  if (sent > 0) logger.info({ sent }, "morning summaries sent");
});

await boss.schedule(REMINDER_DISPATCH, "*/5 * * * *");
await boss.work(REMINDER_DISPATCH, scheduled, async () => {
  const sent = await sendDueReminders({ db, send, logger }, new Date());
  if (sent > 0) logger.info({ sent }, "reminders sent");
});

logger.info("worker started");

onShutdown(logger, async () => {
  await boss.stop({ graceful: true });
  await db.$disconnect();
  await pool.end();
});
