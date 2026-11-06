import { afterAll, beforeAll, expect, it } from "vitest";
import { TEST_DATABASE_URL } from "../test/db";
import { createPool } from "./db";
import {
  createBoss,
  createQueues,
  HEARTBEAT,
  NOTIFY_ITEMS,
  SEND_IT,
  SUMMARY_DISPATCH,
  SYNC_DISPATCH,
  SYNC_USER,
} from "./jobs";

// Its own schema, so it never touches a real pg-boss.
const SCHEMA = "pgboss_jobs_test";
const pool = createPool({ DATABASE_URL: TEST_DATABASE_URL, DB_POOL_MAX: 2 });
// As the web service makes it. Cleanup runs only when a test asks.
const boss = createBoss(pool, { worker: false, schema: SCHEMA });

beforeAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await boss.start();
});
afterAll(async () => {
  await boss.stop({ graceful: false });
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
});

it("sets up the queues, and updates ones made before", async () => {
  // Made by an older version, which kept finished jobs 7 days.
  await boss.createQueue(SYNC_USER, { policy: "exclusive", retryLimit: 0 });

  await createQueues(boss);
  // The worker and the web service both run it.
  await createQueues(boss);

  expect(await boss.getQueue(SYNC_USER)).toMatchObject({
    policy: "exclusive",
    retryLimit: 0,
    deleteAfterSeconds: 60 * 60,
  });
  for (const queue of [HEARTBEAT, SUMMARY_DISPATCH, SEND_IT]) {
    expect(await boss.getQueue(queue)).toMatchObject({
      deleteAfterSeconds: 60 * 60,
    });
  }
  // pg-boss's default.
  expect(await boss.getQueue(NOTIFY_ITEMS)).toMatchObject({
    deleteAfterSeconds: 7 * 24 * 60 * 60,
  });
});

it("cleans up every hour, deleting finished jobs past their time in every queue", async () => {
  await createQueues(boss);
  const errors: unknown[] = [];
  boss.on("error", (err) => errors.push(err));
  // Finishes a job in `queue`, `hoursAgo` hours ago.
  const finish = async (queue: string, hoursAgo: number) => {
    const id = await boss.send(queue, {});
    const [job] = await boss.fetch(queue);
    await boss.complete(queue, job!.id);
    await pool.query(
      `UPDATE ${SCHEMA}.job SET completed_on = now() - make_interval(hours => $2) WHERE id = $1`,
      [id, hoursAgo],
    );
    return { queue, id: id! };
  };
  // Past their hour, in two queues.
  const old = [await finish(HEARTBEAT, 2), await finish(SYNC_DISPATCH, 2)];
  const recent = await finish(HEARTBEAT, 0);
  // The last cleanup was 90 minutes ago: due when cleanup runs hourly, not daily.
  await pool.query(
    `UPDATE ${SCHEMA}.queue SET maintain_on = now() - interval '90 minutes'`,
  );

  await boss.supervise();
  for (const { queue, id } of old) {
    expect(await boss.getJobById(queue, id)).toBeNull();
  }
  expect(await boss.getJobById(HEARTBEAT, recent.id)).not.toBeNull();
  expect(errors).toEqual([]);
});
