import type { Db } from "./db";
import { DAY_MS } from "./health";
import { unseenPrs } from "./sync";

// Resolved items are kept this long. Long enough to reopen an item without notifying
// again if its PR comes back.
export const KEEP_RESOLVED_DAYS = 30;

// Deletes what users no longer need: resolved items over 30 days old, with their push
// logs, and PRs no search has found for a week, with nothing open (see unseenPrs). Each
// sync does the last for its own user. This also covers users who stopped syncing.
// Logs of open items stay: reminders check them so each stage pushes once. Run every
// hour.
export async function cleanUpOldData(db: Db, now: Date) {
  const before = new Date(now.getTime() - KEEP_RESOLVED_DAYS * DAY_MS);
  const [items, prs] = await db.$transaction([
    db.item.deleteMany({
      where: { status: "resolved", resolvedAt: { lt: before } },
    }),
    db.pullRequest.deleteMany({ where: unseenPrs(now) }),
  ]);
  return { items: items.count, prs: prs.count };
}
