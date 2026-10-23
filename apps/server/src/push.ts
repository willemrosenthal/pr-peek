import { DESKTOP_ONLINE_MS, type PushPayload } from "@pr-peek/core";
import type { Logger } from "pino";
import webpush from "web-push";
import type { Config } from "./config";
import type { Db } from "./db";
import type { PushSubscription } from "./generated/prisma/client";

// Failed sends in a row before a device is removed.
export const MAX_PUSH_FAILURES = 5;
// How long a push service keeps trying a device that's offline, for notifications.
export const NOTIFY_TTL_SECONDS = 12 * 60 * 60;

export interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
}

// The VAPID keys, or null when push is off. Config checks they're all set or none are.
export function vapidFrom(config: Config): Vapid | null {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = config;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return null;
  return {
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
    subject: VAPID_SUBJECT,
  };
}

export interface PushOptions {
  // How long the push service keeps trying a device that's offline.
  ttlSeconds: number;
  urgency: "normal" | "high";
}

type PushTarget = Pick<PushSubscription, "endpoint" | "p256dh" | "auth">;

// Sends one push. Throws web-push's WebPushError when the push service refuses it.
export type SendPush = (
  target: PushTarget,
  payload: PushPayload,
  options: PushOptions,
) => Promise<void>;

export function webPushSender(vapid: Vapid): SendPush {
  return async (target, payload, options) => {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      JSON.stringify(payload),
      {
        vapidDetails: vapid,
        TTL: options.ttlSeconds,
        urgency: options.urgency,
      },
    );
  };
}

export interface PushDeps {
  db: Db;
  send: SendPush;
  logger: Logger;
}

export type PushResult = "sent" | "failed" | "removed";

// The push service's answer when a device unsubscribed or its subscription expired.
const isGone = (err: unknown) =>
  err instanceof webpush.WebPushError &&
  (err.statusCode === 404 || err.statusCode === 410);

// Sends to one device and keeps its record up to date. Removes it when the push service
// says it's gone, or after too many failures in a row.
export async function pushToDevice(
  deps: PushDeps,
  device: PushSubscription,
  payload: PushPayload,
  options: PushOptions,
): Promise<PushResult> {
  const { db, logger } = deps;
  const where = { id: device.id };
  try {
    await deps.send(device, payload, options);
  } catch (err) {
    if (isGone(err)) {
      await db.pushSubscription.deleteMany({ where });
      logger.info({ deviceId: device.id }, "push device gone, removed");
      return "removed";
    }
    logger.warn({ err, deviceId: device.id }, "push failed");
    await db.pushSubscription.updateMany({
      where,
      data: { failureCount: { increment: 1 } },
    });
    const { count } = await db.pushSubscription.deleteMany({
      where: { ...where, failureCount: { gte: MAX_PUSH_FAILURES } },
    });
    if (count === 0) return "failed";
    logger.info({ deviceId: device.id }, "push device kept failing, removed");
    return "removed";
  }
  // updateMany, since the user may have removed the device while it sent.
  await db.pushSubscription.updateMany({
    where,
    data: { lastSuccessAt: new Date(), failureCount: 0 },
  });
  return "sent";
}

// Postgres NOTIFY channel for notifications to the Mac menu bar app. The payload is
// `{ userId, payload }`. The web service passes it down the user's live streams.
export const DESKTOP_CHANNEL = "user_desktop_notify";

export const isDesktopOnline = (seenAt: Date | null, now: Date) =>
  seenAt !== null && now.getTime() - seenAt.getTime() < DESKTOP_ONLINE_MS;

// Users with somewhere to send a notification: a push device, or the running Mac app.
export const reachableUsers = (now: Date) => ({
  OR: [
    { pushSubscriptions: { some: {} } },
    { desktopSeenAt: { gt: new Date(now.getTime() - DESKTOP_ONLINE_MS) } },
  ],
});

// Sends a notification to the user's `devices`. While their Mac menu bar app runs, it
// goes to the app instead of the browsers on that Mac. "sent" if anything got it.
export async function deliver(
  deps: PushDeps,
  user: { id: string; desktopSeenAt: Date | null },
  devices: PushSubscription[],
  payload: PushPayload,
  { now, ...options }: PushOptions & { now: Date },
): Promise<"sent" | "failed"> {
  const desktop = isDesktopOnline(user.desktopSeenAt, now);
  if (desktop) {
    const message = JSON.stringify({ userId: user.id, payload });
    await deps.db.$executeRaw`SELECT pg_notify(${DESKTOP_CHANNEL}, ${message})`;
  }
  const targets = desktop ? devices.filter((device) => !device.onMac) : devices;
  const pushed =
    targets.length > 0
      ? await pushToDevices(deps, targets, payload, options)
      : "failed";
  return desktop || pushed === "sent" ? "sent" : "failed";
}

// Sends to each device at once. "sent" if any device got it.
export async function pushToDevices(
  deps: PushDeps,
  devices: PushSubscription[],
  payload: PushPayload,
  options: PushOptions,
): Promise<"sent" | "failed"> {
  const results = await Promise.all(
    devices.map((device) => pushToDevice(deps, device, payload, options)),
  );
  return results.includes("sent") ? "sent" : "failed";
}
