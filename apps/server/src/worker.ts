import type { WorkHandler, WorkOptions } from "pg-boss";
import { loadConfig } from "./config";
import { createDb, createPool } from "./db";
import { getOctokit } from "./github/client";
import { tokenKeys } from "./github/tokens";
import { createGitHubOAuth } from "./github/oauth";
import { cleanUpOldData } from "./cleanup";
import { checkHealth, checkTokenKey } from "./health";
import {
  createBoss,
  createQueues,
  HEALTH_CHECK,
  HEARTBEAT,
  NOTIFY_ITEMS,
  NOTIFY_MERGED,
  POLL_JOBS_SECONDS,
  POLL_LISTENING_SECONDS,
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
import { countJobs, countPool, Usage } from "./usage";
import { sendDueSummaries } from "./summary";
import { dueUsers, isLagging, runSync } from "./sync-schedule";
import { sendTokenReminders } from "./token-reminders";

// The rules' code can only change with a deploy, which restarts the worker. Each user's
// next sync after this runs the rules on every PR (see sync.ts).
const startedAt = new Date();
const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config);
const usage = new Usage("worker");
countPool(pool, usage);
const db = createDb(pool);
const oauth = createGitHubOAuth({
  clientId: config.GITHUB_CLIENT_ID,
  clientSecret: config.GITHUB_CLIENT_SECRET,
});
const boss = createBoss(pool, {
  worker: true,
  listen: { connectionString: config.DATABASE_URL, logger, usage },
});

boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
// Like "couldn't start listening for new jobs": it polls every 10 and 30 seconds instead.
boss.on("warning", (warning) => logger.warn({ warning }, "pg-boss warning"));

await boss.start();

await createQueues(boss);

// Runs a queue's jobs, each counted for the admin page.
const work = <T>(
  queue: string,
  options: WorkOptions,
  handler: WorkHandler<T>,
) => boss.work<T>(queue, options, countJobs(usage, queue, handler));

const scheduled = {
  pollingIntervalSeconds: POLL_SCHEDULED_SECONDS,
  notifyPollingIntervalSeconds: POLL_LISTENING_SECONDS,
};
const jobs = {
  pollingIntervalSeconds: POLL_JOBS_SECONDS,
  notifyPollingIntervalSeconds: POLL_LISTENING_SECONDS,
};

await boss.schedule(HEARTBEAT, "* * * * *");
await work(HEARTBEAT, scheduled, () => {
  logger.info("heartbeat");
  return Promise.resolve();
});

await boss.schedule(SYNC_DISPATCH, "* * * * *");
await work(SYNC_DISPATCH, scheduled, async () => {
  const due = await dueUsers(db, new Date());
  if (due.length === 0) return;
  const queued = await Promise.all(due.map(({ id }) => queueSync(boss, id)));
  logger.info(
    {
      due: due.length,
      queued: queued.filter(Boolean).length,
      // Above 0 for a while means the worker can't keep up: raise SYNC_CONCURRENCY.
      lagging: due.filter(isLagging).length,
    },
    "sync dispatch",
  );
});

await work<{ userId: string }>(
  SYNC_USER,
  { ...jobs, localConcurrency: config.SYNC_CONCURRENCY },
  async ([job]) => {
    if (!job) return;
    await runSync(
      {
        db,
        logger,
        rulesChangedAt: startedAt,
        github: (userId, choice) =>
          getOctokit(
            { db, oauth, ...tokenKeys(config), usage },
            userId,
            choice,
          ),
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
await work<{ itemIds: string[] }>(NOTIFY_ITEMS, jobs, async ([job]) => {
  if (!job) return;
  const { itemIds } = job.data;
  const outcomes = await notifyItems(
    { db, send, logger },
    itemIds.map((itemId) => ({ itemId })),
  );
  logger.info({ itemIds, outcomes }, "notify items");
});

await work<{ prIds: string[] }>(NOTIFY_MERGED, jobs, async ([job]) => {
  if (!job) return;
  const { prIds } = job.data;
  const outcomes = await notifyMerged({ db, send, logger }, prIds);
  logger.info({ prIds, outcomes }, "notify merged");
});

await boss.schedule(SUMMARY_DISPATCH, "*/15 * * * *");
await work(SUMMARY_DISPATCH, scheduled, async () => {
  const sent = await sendDueSummaries({ db, send, logger }, new Date());
  if (sent > 0) logger.info({ sent }, "morning summaries sent");
});

await boss.schedule(REMINDER_DISPATCH, "*/5 * * * *");
await work(REMINDER_DISPATCH, scheduled, async () => {
  const sent = await sendDueReminders({ db, send, logger }, new Date());
  if (sent > 0) logger.info({ sent }, "reminders sent");
});

await boss.schedule(HEALTH_CHECK, "0 * * * *");
await work(HEALTH_CHECK, scheduled, async () => {
  const now = new Date();
  await checkHealth({ db, send, logger }, now);
  const reminded = await sendTokenReminders({ db, send, logger }, now);
  if (reminded > 0) logger.info({ reminded }, "token reminders sent");
  const deleted = await cleanUpOldData(db, now);
  if (deleted.items + deleted.prs > 0) logger.info(deleted, "old data deleted");
});

const stopSavingUsage = usage.saveHourly(db, logger);

logger.info("worker started");
void checkTokenKey({ db, send, logger }, tokenKeys(config), new Date()).catch(
  (err: unknown) => logger.error({ err }, "couldn't check the token key"),
);

onShutdown(logger, async () => {
  await boss.stop({ graceful: true });
  await stopSavingUsage();
  await db.$disconnect();
  await pool.end();
});
