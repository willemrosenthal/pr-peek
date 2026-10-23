import { reminderStage, waitingFor } from "@pr-peek/core";
import { notifyItems, type NotifyDeps, type NotifyRequest } from "./notify";
import { reachableUsers } from "./push";

// Sends a reminder for each review request that reached a new stage: orange, red, or
// another interval past red. A user's reminders go together, so several become one push.
// Run every few minutes. Returns how many reminders went out.
export async function sendDueReminders(
  deps: Omit<NotifyDeps, "now">,
  now: Date,
): Promise<number> {
  const { db } = deps;
  if (!deps.send) return 0;
  // Only review requests wait, so only they have `waitingSince`. Quiet PRs get none.
  const users = await db.user.findMany({
    where: reachableUsers(now),
    select: {
      id: true,
      settings: true,
      items: {
        where: {
          status: "open",
          waitingSince: { not: null },
          pullRequest: { quietAt: null },
        },
        select: { id: true, waitingSince: true },
      },
    },
  });

  let sent = 0;
  for (const { id: userId, settings, items } of users) {
    if (!settings) continue;
    const requests = items.flatMap(({ id, waitingSince }): NotifyRequest[] => {
      if (!waitingSince) return [];
      const stage = reminderStage(
        waitingFor(waitingSince, now, settings),
        settings,
      );
      return stage ? [{ itemId: id, reminder: stage }] : [];
    });
    if (requests.length === 0) continue;
    try {
      const outcomes = await notifyItems({ ...deps, now: () => now }, requests);
      sent += outcomes.filter((outcome) => outcome === "sent").length;
    } catch (err) {
      deps.logger.error({ err, userId }, "reminders failed");
    }
  }
  return sent;
}
