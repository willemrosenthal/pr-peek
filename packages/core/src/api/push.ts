import { z } from "zod";
import type { Severity } from "../rules";
import { severity } from "./settings";

// Keeps each notification's fan out small.
export const MAX_PUSH_DEVICES = 20;

// The browser makers' push services. The server sends to these URLs, so nothing else.
const pushEndpoint = z
  .url({
    protocol: /^https$/,
    hostname:
      /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|.+\.push\.apple\.com|.+\.notify\.windows\.com)$/,
    error: "Not a known push service",
  })
  .max(2000);

export const isPushServiceUrl = (endpoint: string) =>
  pushEndpoint.safeParse(endpoint).success;

const pushKey = z.string().regex(/^[\w-]{1,200}={0,2}$/, "Not a push key");
export const MAX_DEVICE_LABEL = 50;
const deviceLabel = z.string().trim().min(1).max(MAX_DEVICE_LABEL);

// What the browser's PushSubscription.toJSON() gives.
const browserSubscription = z.object({
  endpoint: pushEndpoint,
  keys: z.object({ p256dh: pushKey, auth: pushKey }),
});

export const addPushSubscriptionBody = browserSubscription.extend({
  label: deviceLabel,
});
export type AddPushSubscriptionBody = z.infer<typeof addPushSubscriptionBody>;

export const updatePushSubscriptionBody = z
  .object({
    label: deviceLabel,
    minSeverity: severity,
    // The browser's new subscription, when it replaced the old one.
    subscription: browserSubscription,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");
export type UpdatePushSubscriptionBody = z.infer<
  typeof updatePushSubscriptionBody
>;

export interface PushKeyResponse {
  // The VAPID public key, for pushManager.subscribe().
  publicKey: string;
}

// One device that gets notifications.
export interface PushSubscriptionDto {
  id: string;
  // So a browser can find its own device in the list.
  endpoint: string;
  label: string | null;
  minSeverity: Severity;
  lastSuccessAt: string | null;
  createdAt: string;
}

export interface PushSubscriptionsResponse {
  subscriptions: PushSubscriptionDto[];
}

export interface PushSubscriptionResponse {
  subscription: PushSubscriptionDto;
}

// What the service worker gets in each push.
export interface PushPayload {
  title: string;
  body: string;
  // Opened when the notification is tapped.
  url: string;
  // A newer notification with the same tag replaces the old one.
  tag: string;
  itemId?: string;
}
