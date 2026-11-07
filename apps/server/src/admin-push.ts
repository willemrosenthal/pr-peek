import { isQuiet, type PushPayload } from "@pr-peek/core";
import type { Logger } from "pino";
import type { Db } from "./db";
import { deliver, NOTIFY_TTL_SECONDS, type PushDeps } from "./push";
import { QUIET_SETTINGS } from "./sync-schedule";

export type Admin = Awaited<ReturnType<typeof awakeAdmins>>[number];

// Admins not in their quiet hours, with their devices.
export async function awakeAdmins(db: Db, logger: Logger, now: Date) {
  const admins = await db.user.findMany({
    where: { role: "admin" },
    select: {
      id: true,
      desktopSeenAt: true,
      pushSubscriptions: true,
      settings: { select: QUIET_SETTINGS },
    },
  });
  if (admins.length === 0) logger.warn("no admins to push to");
  return admins.filter(
    (admin) => !(admin.settings && isQuiet(admin.settings, now)),
  );
}

export async function pushToAdmins(
  deps: PushDeps,
  admins: Admin[],
  payload: PushPayload,
  now: Date,
): Promise<void> {
  for (const admin of admins) {
    await deliver(deps, admin, admin.pushSubscriptions, payload, {
      ttlSeconds: NOTIFY_TTL_SECONDS,
      urgency: "normal",
      now,
    });
  }
}
