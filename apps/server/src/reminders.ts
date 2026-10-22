import { reminderStage, waitingFor } from "@pr-peek/core";
import { notifyItem, type NotifyDeps } from "./notify";

// Sends a reminder for each review request that reached a new stage: orange, red, or
// another interval past red. Run every few minutes. Returns how many went out.
export async function sendDueReminders(
  deps: Omit<NotifyDeps, "now">,
  now: Date,
): Promise<number> {
  const { db } = deps;
  if (!deps.send) return 0;
  // Only review requests wait, so only they have `waitingSince`.
  const users = await db.user.findMany({
    where: { pushSubscriptions: { some: {} } },
    select: {
      settings: true,
      items: {
        where: { status: "open", waitingSince: { not: null } },
        select: { id: true, waitingSince: true },
      },
    },
  });

  let sent = 0;
  for (const { settings, items } of users) {
    if (!settings) continue;
    for (const { id, waitingSince } of items) {
      if (!waitingSince) continue;
      const stage = reminderStage(
        waitingFor(waitingSince, now, settings),
        settings,
      );
      if (!stage) continue;
      try {
        const outcome = await notifyItem(
          { ...deps, now: () => now },
          id,
          stage,
        );
        if (outcome === "sent") sent += 1;
      } catch (err) {
        deps.logger.error({ err, itemId: id }, "reminder failed");
      }
    }
  }
  return sent;
}
