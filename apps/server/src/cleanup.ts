import type { Db } from "./db";
import { DAY_MS } from "./health";
import { unseenPrs } from "./sync";

// Resolved items and push logs are kept this long. Long enough to reopen an item
// without notifying again if its PR comes back.
export const KEEP_RESOLVED_DAYS = 30;

// Deletes what users no longer need: resolved items and push logs over 30 days old, and
// PRs no search has found for a week, with nothing open (see unseenPrs). Each sync does
// the last for its own user. This also covers users who stopped syncing. Run every hour.
export async function cleanUpOldData(db: Db, now: Date) {
  const before = new Date(now.getTime() - KEEP_RESOLVED_DAYS * DAY_MS);
  const [logs, items, prs] = await db.$transaction([
    db.notificationLog.deleteMany({ where: { sentAt: { lt: before } } }),
    db.item.deleteMany({
      where: { status: "resolved", resolvedAt: { lt: before } },
    }),
    db.pullRequest.deleteMany({ where: unseenPrs(now) }),
  ]);
  return { logs: logs.count, items: items.count, prs: prs.count };
}
