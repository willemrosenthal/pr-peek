import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, expect, it } from "vitest";
import { TEST_DATABASE_URL } from "../test/db";
import { createPool } from "./db";
import { createQueues, HEARTBEAT, NOTIFY_ITEMS, SYNC_USER } from "./jobs";

// Its own schema, so it never touches a real pg-boss.
const SCHEMA = "pgboss_jobs_test";
const pool = createPool({ DATABASE_URL: TEST_DATABASE_URL, DB_POOL_MAX: 2 });
const boss = new PgBoss({
  db: { executeSql: (text, values) => pool.query(text, values) },
  schema: SCHEMA,
  supervise: false,
  schedule: false,
});

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
  expect(await boss.getQueue(HEARTBEAT)).toMatchObject({
    deleteAfterSeconds: 60 * 60,
  });
  // pg-boss's default.
  expect(await boss.getQueue(NOTIFY_ITEMS)).toMatchObject({
    deleteAfterSeconds: 7 * 24 * 60 * 60,
  });
});
