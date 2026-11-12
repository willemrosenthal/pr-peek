import { z } from "zod";
import type { ItemKind, ReviewState } from "../rules";

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
const MAX_DEVICE_LABEL = 50;
const deviceLabel = z.string().trim().min(1).max(MAX_DEVICE_LABEL);

// What the browser's PushSubscription.toJSON() gives.
const browserSubscription = z.object({
  endpoint: pushEndpoint,
  keys: z.object({ p256dh: pushKey, auth: pushKey }),
});

export const addPushSubscriptionBody = browserSubscription.extend({
  label: deviceLabel,
  // A browser on a Mac. While the Mac menu bar app runs, it gets these notifications.
  onMac: z.boolean().optional(),
});
export type AddPushSubscriptionBody = z.infer<typeof addPushSubscriptionBody>;

export const updatePushSubscriptionBody = z
  .object({
    // The browser's new subscription, when it replaced the old one.
    subscription: browserSubscription,
    onMac: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");
export type UpdatePushSubscriptionBody = z.infer<
  typeof updatePushSubscriptionBody
>;

// The token Apple gives the iPhone app for push: hex, 64 characters today. Apple says it
// may grow, so longer ones are allowed.
const appleToken = z
  .string()
  .regex(/^[0-9a-fA-F]{64,200}$/, "Not an Apple device token")
  .transform((token) => token.toLowerCase());

// The iPhone app registers its token each time it opens (plan 12).
export const addAppleDeviceBody = z.object({
  token: appleToken,
  label: deviceLabel,
  // An Xcode build, which only Apple's sandbox reaches.
  sandbox: z.boolean(),
});
export type AddAppleDeviceBody = z.infer<typeof addAppleDeviceBody>;

export interface AppleDeviceDto {
  id: string;
  label: string | null;
  lastSuccessAt: string | null;
  createdAt: string;
}

export interface AppleDeviceResponse {
  device: AppleDeviceDto;
}

// How many of the user's iPhone apps got all of "Send a test"'s samples, and how many
// didn't.
export interface AppleTestResponse {
  sent: number;
  failed: number;
}

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
  // The count for the app's icon.
  badge?: number;
  // A picture for the notification, like the person who did it. The app icon when
  // missing. iPhones always show the app icon.
  icon?: string;
  // For the iPhone app's notification (plan 12.6): which tile it shows, and the person
  // who did it, with their picture. Web push ignores them.
  kind?: PushKind;
  actor?: string;
  avatar?: string;
}

// Each kind of notification with its own tile in the iPhone app. A review is "approved" or
// "changes_requested", since each has its own tile.
export type PushKind = Exclude<ItemKind, "reviewed"> | ReviewState | "merged";

// Every kind, in the list's order. A record, so a new kind can't be left out.
const KINDS: Record<PushKind, true> = {
  review_requested: true,
  re_requested: true,
  approved: true,
  changes_requested: true,
  commented: true,
  reply: true,
  mention: true,
  check_failed: true,
  assigned: true,
  merged: true,
};
export const PUSH_KINDS = Object.keys(KINDS) as PushKind[];

// The tile for an item's notification. `reviewState` as stored: a review from before it
// was stored counts as approved.
export function pushKindOf(
  kind: ItemKind,
  reviewState: string | null,
): PushKind {
  if (kind !== "reviewed") return kind;
  return reviewState === "changes_requested" ? reviewState : "approved";
}

// A GitHub user's picture, `size` pixels square.
export const githubAvatarUrl = (login: string, size: number) =>
  `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=${size}`;

// The body of a notification about one PR: its title, then where it is.
export const prPushBody = (title: string, repo: string, number: number) =>
  `${title}\n${repo} #${number}`;
