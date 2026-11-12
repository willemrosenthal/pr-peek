import {
  DESKTOP_ONLINE_MS,
  githubAvatarUrl,
  type PushPayload,
} from "@pr-peek/core";
import type { Logger } from "pino";
import webpush from "web-push";
import { isGoneFromApple, type SendApple } from "./apns";
import type { Config } from "./config";
import type { Db } from "./db";
import type { AppleDevice, PushSubscription } from "./generated/prisma/client";

// The picture's size on the iPhone app's notification: 38 points, at 3 pixels each.
export const PUSH_AVATAR_PX = 120;

// The person who did it, for the iPhone app's notification. Nobody for a bot, which has
// no face to show: the notification keeps the app icon.
export const pushActor = (
  login: string | null,
  isBot = false,
): Pick<PushPayload, "actor" | "avatar"> =>
  login && !isBot
    ? { actor: login, avatar: githubAvatarUrl(login, PUSH_AVATAR_PX) }
    : {};

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
  // Null or missing when Apple push is off, because the APNs settings aren't set.
  apple?: SendApple | null | undefined;
  logger: Logger;
}

export type PushResult = "sent" | "failed" | "removed";

// The push service's answer when a device unsubscribed or its subscription expired.
const isGone = (err: unknown) =>
  err instanceof webpush.WebPushError &&
  (err.statusCode === 404 || err.statusCode === 410);

// The parts of a device table that sending touches: web push devices or Apple devices.
interface DeviceTable {
  deleteMany(args: {
    where: { id: string; failureCount?: { gte: number } };
  }): Promise<{ count: number }>;
  updateMany(args: {
    where: { id: string };
    data:
      | { failureCount: { increment: number } }
      | { lastSuccessAt: Date; failureCount: number };
  }): Promise<{ count: number }>;
}

// Sends to one device with `send`, and keeps its record up to date. Removes it when the
// push service says it's gone, or after too many failures in a row.
async function sendAndTrack(
  { logger }: Pick<PushDeps, "logger">,
  table: DeviceTable,
  deviceId: string,
  send: () => Promise<void>,
  isGoneError: (err: unknown) => boolean,
): Promise<PushResult> {
  const where = { id: deviceId };
  try {
    await send();
  } catch (err) {
    if (isGoneError(err)) {
      await table.deleteMany({ where });
      logger.info({ deviceId }, "push device gone, removed");
      return "removed";
    }
    logger.warn({ err, deviceId }, "push failed");
    await table.updateMany({ where, data: { failureCount: { increment: 1 } } });
    const { count } = await table.deleteMany({
      where: { ...where, failureCount: { gte: MAX_PUSH_FAILURES } },
    });
    if (count === 0) return "failed";
    logger.info({ deviceId }, "push device kept failing, removed");
    return "removed";
  }
  // updateMany, since the user may have removed the device while it sent.
  await table.updateMany({
    where,
    data: { lastSuccessAt: new Date(), failureCount: 0 },
  });
  return "sent";
}

// Sends to one web push device. See sendAndTrack.
export const pushToDevice = (
  deps: PushDeps,
  device: PushSubscription,
  payload: PushPayload,
  options: PushOptions,
): Promise<PushResult> =>
  sendAndTrack(
    deps,
    deps.db.pushSubscription,
    device.id,
    () => deps.send(device, payload, options),
    isGone,
  );

// Sends to one iPhone app. See sendAndTrack.
export const pushToAppleDevice = (
  deps: Pick<PushDeps, "db" | "logger">,
  apple: SendApple,
  device: AppleDevice,
  payload: PushPayload,
  options: PushOptions,
): Promise<PushResult> =>
  sendAndTrack(
    deps,
    deps.db.appleDevice,
    device.id,
    () => apple(device, payload, options),
    isGoneFromApple,
  );

// Postgres NOTIFY channel for notifications to the Mac menu bar app. The payload is
// `{ userId, payload }`. The web service passes it down the user's live streams.
export const DESKTOP_CHANNEL = "user_desktop_notify";

export const isDesktopOnline = (seenAt: Date | null, now: Date) =>
  seenAt !== null && now.getTime() - seenAt.getTime() < DESKTOP_ONLINE_MS;

// Users with somewhere to send a notification: a push device, the iPhone app, or the
// running Mac app.
export const reachableUsers = (now: Date) => ({
  OR: [
    { pushSubscriptions: { some: {} } },
    { appleDevices: { some: {} } },
    { desktopSeenAt: { gt: new Date(now.getTime() - DESKTOP_ONLINE_MS) } },
  ],
});

// Web push to an iPhone or iPad: Apple's push service, from a browser that isn't a Mac's.
export const isIosWebPush = (
  device: Pick<PushSubscription, "endpoint" | "onMac">,
) =>
  device.onMac === false &&
  new URL(device.endpoint).hostname.endsWith(".push.apple.com");

// Sends a notification to the user's web push `devices` and their iPhone apps.
// - While their Mac menu bar app runs, it goes to the app instead of the browsers on
//   that Mac.
// - With the iPhone app, it goes to the app instead of the web app on iPhones and iPads,
//   so the phone gets it once.
// "sent" if anything got it.
export async function deliver(
  deps: PushDeps,
  user: { id: string; desktopSeenAt: Date | null },
  devices: PushSubscription[],
  payload: PushPayload,
  { now, ...options }: PushOptions & { now: Date },
): Promise<"sent" | "failed"> {
  const { apple } = deps;
  const desktop = isDesktopOnline(user.desktopSeenAt, now);
  if (desktop) {
    const message = JSON.stringify({ userId: user.id, payload });
    await deps.db.$executeRaw`SELECT pg_notify(${DESKTOP_CHANNEL}, ${message})`;
  }
  const phones = apple
    ? await deps.db.appleDevice.findMany({ where: { userId: user.id } })
    : [];
  const browsers = devices.filter(
    (device) =>
      !(desktop && device.onMac) &&
      !(phones.length > 0 && isIosWebPush(device)),
  );
  const results = await Promise.all([
    ...browsers.map((device) => pushToDevice(deps, device, payload, options)),
    ...(apple
      ? phones.map((device) =>
          pushToAppleDevice(deps, apple, device, payload, options),
        )
      : []),
  ]);
  return desktop || results.includes("sent") ? "sent" : "failed";
}
