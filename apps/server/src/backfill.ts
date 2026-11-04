import { prSnapshot } from "@pr-peek/core";
import type { Db } from "./db";
import { snapshotColumns } from "./sync";

const BATCH = 200;

// Fills the columns worked out from a PR's details, from its stored snapshot, for PRs
// saved before the columns existed. Merged and ended ones too, which no sync fetches
// again. Run when the worker starts. Returns how many it filled.
// Remove with the snapshot column (plan 16, step 16.7).
export async function fillSnapshotColumns(db: Db): Promise<number> {
  let filled = 0;
  // Pages by id, so a snapshot that doesn't parse is skipped, not read forever.
  let after: string | undefined;
  for (;;) {
    const rows = await db.pullRequest.findMany({
      where: { lastPushSha: null, ...(after && { id: { gt: after } }) },
      orderBy: { id: "asc" },
      take: BATCH,
      select: { id: true, snapshot: true, user: { select: { login: true } } },
    });
    const last = rows.at(-1);
    if (!last) return filled;
    after = last.id;
    for (const row of rows) {
      const parsed = prSnapshot.safeParse(row.snapshot);
      if (!parsed.success) continue;
      await db.pullRequest.updateMany({
        where: { id: row.id },
        data: snapshotColumns(parsed.data, row.user.login),
      });
      filled += 1;
    }
  }
}
