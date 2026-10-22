import { isAtLeast, isQuiet, type PushPayload } from "@pr-peek/core";
import type { Logger } from "pino";
import type { Db } from "./db";
import { openItems, summarize } from "./item-list";
import { loadRuleSettings } from "./items";
import { NOTIFY_TTL_SECONDS, pushToDevices, type SendPush } from "./push";

export interface NotifyDeps {
  db: Db;
  // Null when push is off, because the VAPID keys aren't set.
  send: SendPush | null;
  logger: Logger;
  now?: () => Date;
}

// What happened, for logs and tests.
export type NotifyOutcome =
  | "sent"
  | "failed"
  | "push_off"
  | "not_open"
  | "seen"
  | "rule_off"
  | "muted"
  | "quiet"
  | "no_devices"
  | "already_sent";

// Sends a push about an item's latest event to the user's devices, unless something says
// not to. Each event notifies at most once, even if this runs again.
export async function notifyItem(
  deps: NotifyDeps,
  itemId: string,
): Promise<NotifyOutcome> {
  const { db, send } = deps;
  const now = deps.now?.() ?? new Date();
  if (!send) return "push_off";

  const item = await db.item.findUnique({
    where: { id: itemId },
    include: {
      pullRequest: true,
      user: { include: { settings: true, pushSubscriptions: true } },
    },
  });
  if (!item || item.status !== "open") return "not_open";
  if (item.seenAt) return "seen";

  const { userId, pullRequest: pr, user } = item;
  const setting = (await loadRuleSettings(db, userId)).find(
    (s) => s.rule.id === item.kind,
  );
  if (!setting?.enabled || !setting.channels.includes("push")) {
    return "rule_off";
  }
  const repo = await db.watchedRepo.findUnique({
    where: {
      userId_githubRepoId: { userId, githubRepoId: pr.githubRepoId },
    },
    select: { muted: true },
  });
  if (repo?.muted) return "muted";

  const { settings } = user;
  const breaksQuiet = settings?.highBreaksQuiet && setting.severity === "high";
  if (settings && isQuiet(settings, now) && !breaksQuiet) return "quiet";

  const devices = user.pushSubscriptions.filter((device) =>
    isAtLeast(setting.severity, device.minSeverity),
  );
  if (devices.length === 0) return "no_devices";

  // Claims the event before sending. A second run finds the row and stops.
  const logKey = {
    itemId,
    eventId: item.latestEventId,
    channel: "push" as const,
  };
  const { count } = await db.notificationLog.createMany({
    data: [{ userId, ...logKey }],
    skipDuplicates: true,
  });
  if (count === 0) return "already_sent";

  // Past the claim, a retry would stop at the claim, so errors end as "failed" here.
  let outcome: "sent" | "failed" = "failed";
  try {
    const badge = summarize(await openItems(db, userId, now)).total;
    const payload: PushPayload = {
      title: item.summary,
      body: `${pr.title}\n${pr.repoName} #${pr.number}`,
      url: pr.url,
      tag: itemId,
      itemId,
      badge,
    };
    outcome = await pushToDevices(
      { db, send, logger: deps.logger },
      devices,
      payload,
      {
        ttlSeconds: NOTIFY_TTL_SECONDS,
        urgency: setting.severity === "high" ? "high" : "normal",
      },
    );
  } catch (err) {
    deps.logger.error({ err, itemId }, "notify failed");
  }
  await db.notificationLog.update({
    where: { itemId_eventId_channel: logKey },
    data: { status: outcome },
  });
  return outcome;
}
