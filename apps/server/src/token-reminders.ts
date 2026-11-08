import {
  daysLeft,
  EXPIRING_DAYS,
  isQuiet,
  plural,
  type PushPayload,
} from "@pr-peek/core";
import type { Logger } from "pino";
import type { Db } from "./db";
import {
  deliver,
  NOTIFY_TTL_SECONDS,
  reachableUsers,
  type SendPush,
} from "./push";
import { QUIET_SETTINGS } from "./sync-schedule";
import { DAY_MS } from "./health";

export interface TokenReminderDeps {
  db: Db;
  // Null when push is off, because the VAPID keys aren't set.
  send: SendPush | null;
  logger: Logger;
}

// What a reminder says: a token about to expire, or one that stopped.
function reminderFor(
  token: { id: string; name: string; status: string; expiresAt: Date | null },
  now: Date,
): PushPayload {
  const days = token.expiresAt ? daysLeft(token.expiresAt, now) : 0;
  const body =
    token.status === "stopped"
      ? `Your ${token.name} token stopped working. Its repos sync with another token or your GitHub sign in for now. Replace it in Settings.`
      : days > 0
        ? `Your ${token.name} token expires in ${plural(days, "day")}. Replace it to keep its repos syncing.`
        : `Your ${token.name} token expired. Replace it to keep its repos syncing.`;
  return {
    title: "A GitHub token needs you",
    body,
    url: "/settings/general",
    tag: `token-${token.id}`,
  };
}

// Pushes, once each per token: when it expires within EXPIRING_DAYS, and on the day it
// stopped working. A user in their quiet hours gets theirs after. Run every hour. Returns
// how many went out.
export async function sendTokenReminders(
  deps: TokenReminderDeps,
  now: Date,
): Promise<number> {
  const { db, send, logger } = deps;
  if (!send) return 0;
  const tokens = await db.gitHubToken.findMany({
    where: {
      OR: [
        {
          status: "working",
          expiryRemindedAt: null,
          expiresAt: { lte: new Date(now.getTime() + EXPIRING_DAYS * DAY_MS) },
        },
        // On the day it stops, so a user who gets a device later isn't told of old ones.
        {
          status: "stopped",
          stopRemindedAt: null,
          stoppedAt: { gte: new Date(now.getTime() - DAY_MS) },
        },
      ],
      user: reachableUsers(now),
    },
    select: {
      id: true,
      name: true,
      status: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          desktopSeenAt: true,
          pushSubscriptions: true,
          settings: { select: QUIET_SETTINGS },
        },
      },
    },
  });

  let sent = 0;
  for (const { user, ...token } of tokens) {
    if (user.settings && isQuiet(user.settings, now)) continue;
    try {
      const result = await deliver(
        { db, send, logger },
        user,
        user.pushSubscriptions,
        reminderFor(token, now),
        { ttlSeconds: NOTIFY_TTL_SECONDS, urgency: "normal", now },
      );
      if (result === "sent") sent++;
    } catch (err) {
      logger.error({ err, tokenId: token.id }, "token reminder failed");
    }
    // Once, whatever happened, so a device that's gone doesn't get one every hour.
    await db.gitHubToken.updateMany({
      where: { id: token.id },
      data:
        token.status === "stopped"
          ? { stopRemindedAt: now }
          : { expiryRemindedAt: now },
    });
  }
  return sent;
}
