import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { TEST_DATABASE_URL } from "../test/db";
import { createPool } from "./db";
import { createLogger } from "./logger";
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
  // Every queue wakes the worker, including one made before.
  for (const queue of [SYNC_USER, NOTIFY_ITEMS, SYNC_DISPATCH, SEND_IT]) {
    expect(await boss.getQueue(queue)).toMatchObject({ notify: true });
  }
});

it("wakes a listening worker as soon as a job is added", async () => {
  await createQueues(boss);
  const workerPool = createPool({
    DATABASE_URL: TEST_DATABASE_URL,
    DB_POOL_MAX: 2,
  });
  // As the worker makes it, minus scheduled jobs and upkeep.
  const worker = createBoss(workerPool, {
    worker: false,
    schema: SCHEMA,
    listen: {
      connectionString: TEST_DATABASE_URL,
      logger: createLogger({ LOG_LEVEL: "silent" }),
    },
  });
  const warnings: unknown[] = [];
  worker.on("warning", (warning) => warnings.push(warning));
  try {
    await worker.start();
    const handled = vi.fn();
    // Checks once at start, then not for a minute while it listens.
    await worker.work(
      NOTIFY_ITEMS,
      { pollingIntervalSeconds: 30, notifyPollingIntervalSeconds: 60 },
      handled,
    );
    // Its check at start is done, so only a wake-up can find the job.
    await vi.waitFor(() =>
      expect(worker.getWipData()[0]?.lastFetchedOn).toBeTruthy(),
    );

    // Added by the web service, which doesn't listen.
    await boss.send(NOTIFY_ITEMS, { itemIds: ["a"] });
    await vi.waitFor(() => expect(handled).toHaveBeenCalledOnce(), {
      timeout: 5_000,
    });
    expect(warnings).toEqual([]);
  } finally {
    await worker.stop({ graceful: false });
    await workerPool.end();
  }
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

it("re-reads the queues' settings hourly, not every minute", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let reads = 0;
  const watched = createPool({
    DATABASE_URL: TEST_DATABASE_URL,
    DB_POOL_MAX: 1,
  });
  const query = watched.query.bind(watched);
  watched.query = ((text: string, values?: unknown[]) => {
    if (typeof text === "string" && text.includes(`FROM ${SCHEMA}.queue q`)) {
      reads += 1;
    }
    return query(text, values);
  }) as typeof watched.query;
  const other = createBoss(watched, { worker: false, schema: SCHEMA });
  try {
    await other.start();
    const atStart = reads;
    // pg-boss reads them once at start, so the test spots its reads at all.
    expect(atStart).toBeGreaterThan(0);
    // pg-boss's default would read twice in 2 minutes.
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(reads).toBe(atStart);
  } finally {
    vi.useRealTimers();
    await other.stop({ graceful: false });
    await watched.end();
  }
});
