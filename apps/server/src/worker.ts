import { PgBoss } from "pg-boss";
import { loadConfig } from "./config";
import { createDb, createPool } from "./db";
import { getOctokit } from "./github/client";
import { createGitHubOAuth } from "./github/oauth";
import { createLogger } from "./logger";
import { onShutdown } from "./shutdown";
import { dueUserIds, runSync } from "./sync-schedule";

const SYNC_DISPATCH = "sync-dispatch";
const SYNC_USER = "sync-user";
// Syncs running at once, so one slow user doesn't hold up everyone.
const SYNC_CONCURRENCY = 5;

const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config);
const db = createDb(pool);
const oauth = createGitHubOAuth({
  clientId: config.GITHUB_CLIENT_ID,
  clientSecret: config.GITHUB_CLIENT_SECRET,
});
// Shares the pool with Prisma, to keep connection counts low.
const boss = new PgBoss({
  db: { executeSql: (text, values) => pool.query(text, values) },
});

boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

await boss.start();

await boss.createQueue("heartbeat");
await boss.schedule("heartbeat", "* * * * *");
await boss.work("heartbeat", () => {
  logger.info("heartbeat");
  return Promise.resolve();
});

await boss.createQueue(SYNC_DISPATCH);
// "exclusive" with a singletonKey: one queued or running sync per user.
// No retries: runSync backs off on its own.
await boss.createQueue(SYNC_USER, {
  policy: "exclusive",
  retryLimit: 0,
  expireInSeconds: 10 * 60,
});

await boss.schedule(SYNC_DISPATCH, "* * * * *");
await boss.work(SYNC_DISPATCH, async () => {
  const userIds = await dueUserIds(db, new Date());
  if (userIds.length === 0) return;
  const jobIds = await Promise.all(
    userIds.map((userId) =>
      boss.send(SYNC_USER, { userId }, { singletonKey: userId }),
    ),
  );
  logger.info(
    { due: userIds.length, queued: jobIds.filter(Boolean).length },
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
      },
      job.data.userId,
    );
  },
);

logger.info("worker started");

onShutdown(logger, async () => {
  await boss.stop({ graceful: true });
  await db.$disconnect();
  await pool.end();
});
