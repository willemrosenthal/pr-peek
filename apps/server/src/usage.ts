import type { Logger } from "pino";
import type pg from "pg";
import type { Db } from "./db";
import { Prisma } from "./generated/prisma/client";
import { MINUTE_MS } from "./sync-timing";

// Usage for the admin page, counted in memory and saved once an hour, so watching adds
// no reads and one small write an hour. See docs/19-admin.md, "Cost rules".

export type UsageSource = "web" | "worker";
type Period = "day" | "hour";

export const SAVE_EVERY_MS = 60 * MINUTE_MS;
// Most rows waiting to be saved. More go under "other", so odd queries can't add many.
export const MAX_ENTRIES = 100;
export const OTHER = "other";

interface Amount {
  // How many. 1 when left out.
  count?: number;
  total?: number;
  low?: number;
  high?: number;
}

interface Entry {
  bucket: Date;
  metric: string;
  key: string;
  count: number;
  total: number;
  low: number | null;
  high: number | null;
}

const startOf = (period: Period, at: Date) => {
  const start = new Date(at);
  start.setUTCMinutes(0, 0, 0);
  if (period === "day") start.setUTCHours(0);
  return start;
};

const lower = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.min(a, b);
const higher = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.max(a, b);

const idOf = (e: Entry) => `${e.bucket.toISOString()} ${e.metric} ${e.key}`;

export class Usage {
  private entries = new Map<string, Entry>();

  constructor(
    readonly source: UsageSource,
    readonly now: () => Date = () => new Date(),
  ) {}

  // Adds to today's count of `metric` and `key`, or this hour's.
  add(
    metric: string,
    key: string,
    amount: Amount = {},
    period: Period = "day",
  ) {
    this.merge({
      bucket: startOf(period, this.now()),
      metric,
      key,
      count: amount.count ?? 1,
      total: amount.total ?? 0,
      low: amount.low ?? null,
      high: amount.high ?? null,
    });
  }

  private merge(next: Entry) {
    if (!this.entries.has(idOf(next)) && this.entries.size >= MAX_ENTRIES) {
      next = { ...next, key: OTHER };
    }
    const entry = this.entries.get(idOf(next));
    if (!entry) {
      this.entries.set(idOf(next), { ...next });
      return;
    }
    entry.count += next.count;
    entry.total += next.total;
    entry.low = lower(entry.low, next.low);
    entry.high = higher(entry.high, next.high);
  }

  // Saves the counts in one insert, adding to rows saved before. Counts made while it
  // saves wait for the next save. A failed save keeps its counts for the next one.
  async save(db: Db): Promise<void> {
    if (this.entries.size === 0) return;
    const entries = [...this.entries.values()];
    this.entries.clear();
    const big = (n: number | null) =>
      n === null ? null : BigInt(Math.round(n));
    const rows = entries.map(
      (e) =>
        Prisma.sql`(${e.bucket}, ${this.source}, ${e.metric}, ${e.key}, ${big(e.count)}, ${big(e.total)}, ${big(e.low)}, ${big(e.high)})`,
    );
    try {
      // No RETURNING: the answer is a few bytes, whatever the row count.
      await db.$executeRaw`
        INSERT INTO "UsageStat" ("bucket", "source", "metric", "key", "count", "total", "low", "high")
        VALUES ${Prisma.join(rows)}
        ON CONFLICT ("bucket", "source", "metric", "key") DO UPDATE SET
          "count" = "UsageStat"."count" + EXCLUDED."count",
          "total" = "UsageStat"."total" + EXCLUDED."total",
          "low" = LEAST("UsageStat"."low", EXCLUDED."low"),
          "high" = GREATEST("UsageStat"."high", EXCLUDED."high")`;
    } catch (err) {
      for (const entry of entries) this.merge(entry);
      throw err;
    }
  }

  // Saves every hour. Returns a stop that saves one last time, for shutdown.
  saveHourly(db: Db, logger: Logger): () => Promise<void> {
    const save = () =>
      this.save(db).catch((err: unknown) => {
        logger.warn({ err }, "couldn't save usage counts");
      });
    const timer = setInterval(() => void save(), SAVE_EVERY_MS);
    timer.unref();
    return async () => {
      clearInterval(timer);
      await save();
    };
  }
}

// The table a query reads or writes, after FROM, INTO, or UPDATE, with its schema
// unless it's "public".
const TABLE = /\b(?:FROM|INTO|UPDATE)\s+(?:"?(\w+)"?\.)?"?(\w+)"?/i;
const VERB = /^\s*(\w+)/;
// Kinds already worked out, so most queries skip the regexes. Capped, since some SQL
// differs every time.
const kinds = new Map<string, string>();
const MAX_KINDS = 500;

// A short name for what a query does, like "PullRequest select" or "pgboss.job update".
export function queryKind(sql: string): string {
  const known = kinds.get(sql);
  if (known) return known;
  const verb = VERB.exec(sql)?.[1]?.toLowerCase() ?? OTHER;
  const match = TABLE.exec(sql);
  const schema = match?.[1] && match[1] !== "public" ? `${match[1]}.` : "";
  const kind = match ? `${schema}${match[2]} ${verb}` : verb;
  if (kinds.size < MAX_KINDS) kinds.set(sql, kind);
  return kind;
}

type QueryFn = (...args: unknown[]) => unknown;

const sqlOf = (arg: unknown): string =>
  typeof arg === "string"
    ? arg
    : typeof (arg as { text?: unknown } | null)?.text === "string"
      ? (arg as { text: string }).text
      : "";

// Counts the bytes Postgres sends on a connection, by the kind of query, as "db". Read
// off the socket, so it's the real egress, not a guess from the rows. Each query gets
// the bytes since the last count, so nothing counts twice. Opening the connection
// counts as "connect", and LISTEN messages as "notify".
export function countConnection(client: pg.Client, usage: Usage): void {
  const socket = (
    client as unknown as { connection?: { stream?: { bytesRead?: unknown } } }
  ).connection?.stream;
  // pg's internals moved. Count nothing rather than break queries.
  if (typeof socket?.bytesRead !== "number") return;
  const bytesRead = () => socket.bytesRead as number;

  let counted = 0;
  const take = (key: string) => {
    const read = bytesRead();
    if (read > counted) usage.add("db", key, { total: read - counted });
    counted = read;
  };
  take("connect");
  client.on("notification", () => take("notify"));

  const query = client.query.bind(client) as QueryFn;
  (client as unknown as { query: QueryFn }).query = (...args) => {
    const kind = queryKind(sqlOf(args[0]));
    const last = args.at(-1);
    // pg-pool and pg-boss pass a callback. Prisma awaits a promise.
    if (typeof last === "function") {
      const done = last as QueryFn;
      args[args.length - 1] = (...results: unknown[]) => {
        take(kind);
        return done(...results);
      };
      return query(...args);
    }
    const result = query(...args);
    return result instanceof Promise
      ? result.finally(() => take(kind))
      : result;
  };
}

// Counts the bytes of every connection the pool opens.
export function countPool(pool: pg.Pool, usage: Usage): void {
  pool.on("connect", (client) => countConnection(client, usage));
}

// Counts a worker job: per queue per day, with its time, and all jobs per hour.
export function countJobs<T extends unknown[]>(
  usage: Usage,
  queue: string,
  handler: (jobs: T) => Promise<unknown>,
): (jobs: T) => Promise<void> {
  return async (jobs) => {
    const started = usage.now().getTime();
    usage.add("jobs", "all", {}, "hour");
    try {
      await handler(jobs);
    } catch (err) {
      usage.add("job-failed", queue);
      throw err;
    } finally {
      const ms = usage.now().getTime() - started;
      usage.add("job", queue, { total: ms, high: ms });
    }
  };
}
