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
  // A browser on a Mac. While the Mac menu bar app runs, it gets these notifications.
  onMac: z.boolean().optional(),
});
export type AddPushSubscriptionBody = z.infer<typeof addPushSubscriptionBody>;

export const updatePushSubscriptionBody = z
  .object({
    label: deviceLabel,
    minSeverity: severity,
    // The browser's new subscription, when it replaced the old one.
    subscription: browserSubscription,
    onMac: z.boolean(),
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
  // The count for the app's icon.
  badge?: number;
  // A picture for the notification, like the person who did it. The app icon when
  // missing. iPhones always show the app icon.
  icon?: string;
}

// The body of a notification about one PR: its title, then where it is.
export const prPushBody = (title: string, repo: string, number: number) =>
  `${title}\n${repo} #${number}`;

// GitHub's default picture for an account without one. Made up names get one too.
const testAvatar = (login: string) =>
  `https://github.com/identicons/${login}.png`;

// The made up PRs the tests are about.
const LOGIN_FIX = prPushBody("Fix login redirect loop", "acme/web", 482);
const RETRY = prPushBody("Add retry to webhook sender", "acme/api", 812);

// One test of each kind of notification, worded like the real ones. "Send test" goes
// through them in order. Each has its own tag, so they stack instead of replacing.
export const TEST_PUSHES: { name: string; payload: PushPayload }[] = [
  {
    name: "Review requested",
    payload: {
      title: "Review requested",
      body: RETRY,
      icon: testAvatar("maya-chen"),
    },
  },
  {
    name: "Re-review requested",
    payload: {
      title: "Re-review requested",
      body: prPushBody("Move auth to middleware", "acme/web", 477),
      icon: testAvatar("sam-ortiz"),
    },
  },
  {
    name: "Approved",
    payload: {
      title: "priya-das approved",
      body: LOGIN_FIX,
      icon: testAvatar("priya-das"),
    },
  },
  {
    name: "Changes requested",
    payload: {
      title: "leo-park requested changes",
      body: LOGIN_FIX,
      icon: testAvatar("leo-park"),
    },
  },
  {
    name: "Comment",
    payload: {
      title: 'jordan-lee: "Could we cache this? It runs on every render."',
      body: LOGIN_FIX,
      icon: testAvatar("jordan-lee"),
    },
  },
  {
    name: "Reply",
    payload: {
      title: 'maya-chen: "Good call, updated in 3f2a1c."',
      body: RETRY,
      icon: testAvatar("maya-chen"),
    },
  },
  {
    name: "Mention",
    payload: {
      title: 'alex-kim: "Can you check the migration before I merge?"',
      body: prPushBody("Split billing tables", "acme/api", 820),
      icon: testAvatar("alex-kim"),
    },
  },
  {
    name: "Checks failed",
    payload: {
      title: "test (ubuntu), lint",
      body: LOGIN_FIX,
    },
  },
  {
    name: "Overdue reminder",
    payload: {
      title: "Waiting 2d: Review requested",
      body: RETRY,
      icon: testAvatar("maya-chen"),
    },
  },
  {
    name: "Several at once",
    payload: {
      title: "4 things need you",
      body: [
        "Review requested",
        "priya-das approved",
        "test (ubuntu), lint",
        "+1 more",
      ].join("\n"),
    },
  },
  {
    name: "Morning summary",
    payload: {
      title: "Morning summary",
      body: "2 reviews waiting (oldest 2d), 1 failing check, 1 reply",
    },
  },
].map(({ name, payload }, index) => ({
  name,
  payload: { ...payload, url: "/", tag: `test-${index}` },
}));

// Which test to send. Missing sends the first.
export const testPushBody = z
  .object({
    sample: z
      .int()
      .min(0)
      .max(TEST_PUSHES.length - 1),
  })
  .partial();
export type TestPushBody = z.infer<typeof testPushBody>;
