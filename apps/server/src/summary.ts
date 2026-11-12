import { summaryDueDate, summaryText } from "@pr-peek/core";
import type { Logger } from "pino";
import type { SendApple } from "./apns";
import type { Db } from "./db";
import { openItems, summarize } from "./item-list";
import {
  deliver,
  NOTIFY_TTL_SECONDS,
  reachableUsers,
  type SendPush,
} from "./push";

export interface SummaryDeps {
  db: Db;
  // Null when push is off, because the VAPID keys aren't set.
  send: SendPush | null;
  // Null when Apple push is off, because the APNs settings aren't set.
  apple?: SendApple | null;
  logger: Logger;
}

export type SummaryOutcome =
  "sent" | "failed" | "nothing_open" | "already_sent";

// Sends each due morning summary. Run every 15 minutes. Returns how many went out.
export async function sendDueSummaries(
  deps: SummaryDeps,
  now: Date,
): Promise<number> {
  const { db, send } = deps;
  if (!send) return 0;
  const rows = await db.userSettings.findMany({
    where: { digestTime: { not: null }, user: reachableUsers(now) },
    select: {
      userId: true,
      timezone: true,
      digestTime: true,
      lastSummaryDate: true,
    },
  });

  let sent = 0;
  for (const row of rows) {
    const today = summaryDueDate(row, now);
    if (!today) continue;
    try {
      const outcome = await sendSummary(
        { ...deps, send },
        row.userId,
        today,
        now,
      );
      if (outcome === "sent") sent += 1;
    } catch (err) {
      deps.logger.error({ err, userId: row.userId }, "summary failed");
    }
  }
  return sent;
}

// Sends the user's summary for `today`, their local date. Skipped if nothing is open.
export async function sendSummary(
  deps: SummaryDeps & { send: SendPush },
  userId: string,
  today: string,
  now: Date,
): Promise<SummaryOutcome> {
  const { db } = deps;
  // Claims today's summary first, so a second run doesn't send it again.
  const { count } = await db.userSettings.updateMany({
    where: {
      userId,
      OR: [{ lastSummaryDate: null }, { lastSummaryDate: { not: today } }],
    },
    data: { lastSummaryDate: today },
  });
  if (count === 0) return "already_sent";

  // Reviews waiting on the author aren't yours to do yet.
  const items = await openItems(db, userId, now);
  const text = summaryText(
    items.filter((item) => !item.waitingOnAuthor),
    now,
  );
  if (!text) return "nothing_open";

  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, desktopSeenAt: true, pushSubscriptions: true },
  });
  return deliver(
    deps,
    user,
    user.pushSubscriptions,
    {
      title: "Morning summary",
      body: text,
      url: "/",
      tag: "summary",
      badge: summarize(items).total,
    },
    { ttlSeconds: NOTIFY_TTL_SECONDS, urgency: "normal", now },
  );
}
