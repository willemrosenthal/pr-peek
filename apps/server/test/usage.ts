import type { Db } from "../src/db";
import type { Usage } from "../src/usage";

const num = (n: bigint | null) => (n === null ? null : Number(n));

// Saves `usage`, then reads back every row saved, as plain numbers, sorted.
export async function savedUsage(db: Db, usage: Usage) {
  await usage.save(db);
  const rows = await db.usageStat.findMany({
    orderBy: [{ bucket: "asc" }, { metric: "asc" }, { key: "asc" }],
  });
  return rows.map((row) => ({
    bucket: row.bucket,
    source: row.source,
    metric: row.metric,
    key: row.key,
    count: Number(row.count),
    total: Number(row.total),
    low: num(row.low),
    high: num(row.high),
  }));
}
