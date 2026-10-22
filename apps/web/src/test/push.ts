import { onTestFinished, vi } from "vitest";

// A real VAPID public key, so the page can decode it.
export const PUBLIC_KEY =
  "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
export const SUBSCRIPTION_KEYS = { p256dh: "p256dh-key", auth: "auth-key" };
// The endpoint the browser gives when this page subscribes.
export const THIS_ENDPOINT = "https://fcm.googleapis.com/fcm/send/this-device";

// jsdom has no push. Fakes the browser's Notification, service worker, and pushManager.
// `answer` is what the user picks when asked. `subscribed` is an endpoint the browser
// already has. `worker: false` is like dev, where no service worker runs.
export function stubPush({
  permission = "default",
  answer = "granted",
  subscribed = null,
  worker = true,
}: {
  permission?: NotificationPermission;
  answer?: NotificationPermission;
  subscribed?: string | null;
  worker?: boolean;
} = {}) {
  const subscriptionAt = (endpoint: string) => ({
    endpoint,
    toJSON: () => ({ endpoint, keys: SUBSCRIPTION_KEYS }),
    unsubscribe: vi.fn(() => {
      current = null;
      return Promise.resolve(true);
    }),
  });
  let current = subscribed ? subscriptionAt(subscribed) : null;

  const pushManager = {
    getSubscription: vi.fn(() => Promise.resolve(current)),
    subscribe: vi.fn(() => {
      current = subscriptionAt(THIS_ENDPOINT);
      return Promise.resolve(current);
    }),
  };
  const notification = {
    permission,
    requestPermission: vi.fn(() => {
      notification.permission = answer;
      return Promise.resolve(answer);
    }),
  };

  vi.stubGlobal("Notification", notification);
  vi.stubGlobal("PushManager", class {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: () =>
        Promise.resolve(worker ? { pushManager } : undefined),
    },
  });
  onTestFinished(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  return { pushManager, notification, subscription: () => current };
}
