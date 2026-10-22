import type { PushPayload } from "@pr-peek/core";
import type { Logger } from "pino";
import webpush from "web-push";
import type { Config } from "./config";
import type { Db } from "./db";
import type { PushSubscription } from "./generated/prisma/client";

// Failed sends in a row before a device is removed.
export const MAX_PUSH_FAILURES = 5;

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

export type PushResult = "sent" | "gone" | "failed";

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
  const { db } = deps;
  const where = { id: device.id };
  try {
    await deps.send(device, payload, options);
  } catch (err) {
    if (isGone(err)) {
      await db.pushSubscription.deleteMany({ where });
      return "gone";
    }
    deps.logger.warn({ err, deviceId: device.id }, "push failed");
    await db.pushSubscription.updateMany({
      where,
      data: { failureCount: { increment: 1 } },
    });
    await db.pushSubscription.deleteMany({
      where: { ...where, failureCount: { gte: MAX_PUSH_FAILURES } },
    });
    return "failed";
  }
  // updateMany, since the user may have removed the device while it sent.
  await db.pushSubscription.updateMany({
    where,
    data: { lastSuccessAt: new Date(), failureCount: 0 },
  });
  return "sent";
}
