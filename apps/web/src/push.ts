import type {
  PushSubscriptionResponse,
  PushSubscriptionsResponse,
} from "@pr-peek/core";
import { api, ApiError } from "./api";
import { detectPlatform, isStandalone } from "./install";
import { store, stored } from "./storage";

export type PushSupport = "supported" | "needs-install" | "unsupported";

export function pushSupport(): PushSupport {
  // iPhone and iPad only offer push to Home Screen apps. Checked first, since Safari in a
  // tab has no PushManager at all.
  if (detectPlatform() === "ios" && !isStandalone()) return "needs-install";
  const supported =
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  return supported ? "supported" : "unsupported";
}

const OS_NAMES: [RegExp, string][] = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/CrOS/, "Chromebook"],
  [/Macintosh/, "Mac"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
];

// Edge and Chrome also say "Safari", and Edge says "Chrome", so the order matters.
const BROWSER_NAMES: [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/Firefox|FxiOS/, "Firefox"],
  [/Chrome|CriOS/, "Chrome"],
  [/Safari/, "Safari"],
];

const nameFrom = (names: [RegExp, string][], ua: string) =>
  names.find(([pattern]) => pattern.test(ua))?.[1];

// A name for this device, like "Mac, Chrome". iPhones and iPads get push only in the
// Home Screen app, so their browser doesn't matter.
export function deviceLabel(ua = navigator.userAgent): string {
  const os = nameFrom(OS_NAMES, ua);
  if (os === "iPhone" || os === "iPad") return os;
  const browser = nameFrom(BROWSER_NAMES, ua);
  return [os, browser].filter(Boolean).join(", ") || "Browser";
}

// The VAPID public key comes as base64url text. pushManager wants the bytes.
function keyBytes(publicKey: string) {
  const base64 = publicKey.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

// Asks for permission, subscribes this browser, and saves it as a device. Call it
// straight from a tap: iOS only asks for permission during one.
export async function turnOnPush(publicKey: string) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notifications weren't allowed.");
  }
  // Not `serviceWorker.ready`, which never settles when there's no worker, as in dev.
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) throw new Error("Reload the page and try again.");
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey),
  });
  return saveDevice(subscription);
}

// Saves this browser's subscription as one of the user's devices.
async function saveDevice(subscription: PushSubscription) {
  const { subscription: device } = await api<PushSubscriptionResponse>(
    "/push/subscriptions",
    {
      method: "POST",
      body: { ...subscription.toJSON(), label: deviceLabel(), onMac: onMac() },
    },
  );
  store(SAVED_ENDPOINT_KEY, device.endpoint);
  store(MAC_SENT_KEY, device.endpoint);
  return device;
}

// A browser on a Mac. iPads in desktop mode say they're Macs too, but have touch.
export const onMac = (ua = navigator.userAgent) =>
  /Macintosh/.test(ua) && !(navigator.maxTouchPoints > 1);

async function currentSubscription() {
  if (pushSupport() !== "supported") return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

// This browser's push endpoint, to find it in the device list. Null when it has none.
export async function thisDeviceEndpoint() {
  return (await currentSubscription())?.endpoint ?? null;
}

// The endpoint this browser last saved as a device, to spot when the browser changes it.
const SAVED_ENDPOINT_KEY = "push-endpoint";
// The endpoint whose device the server knows is or isn't on a Mac.
const MAC_SENT_KEY = "push-on-mac-sent";

// Who this browser's notifications were paused for, when they signed out.
const PAUSED_FOR_KEY = "pr-peek:push-paused-for";

// After signing out, when the server removed this browser's device: the browser keeps
// its subscription, so signing in again as the same user turns notifications back on
// (resumeWebPush). Nothing reaches it meanwhile, since the server has no device to send
// to.
export function pauseWebPush(userId: string) {
  store(PAUSED_FOR_KEY, userId);
}

// Drops this browser's subscription, so it gets nothing at all. Turning notifications
// on again subscribes again. Never throws: it's only tidying up.
export async function dropWebPush() {
  store(PAUSED_FOR_KEY, null);
  try {
    const current = await currentSubscription();
    if (!current) return;
    store(SAVED_ENDPOINT_KEY, null);
    store(MAC_SENT_KEY, null);
    await current.unsubscribe();
  } catch {
    // Nothing more to do.
  }
}

// Run when the app opens. If this browser's notifications were paused when this user
// signed out, saves it as their device again. If someone else signed in, drops it, so
// nothing of the other user's can reach them. Returns true if it saved the device.
export async function resumeWebPush(userId: string): Promise<boolean> {
  const pausedFor = stored(PAUSED_FOR_KEY);
  if (!pausedFor) return false;
  const current = await currentSubscription();
  // Turned off in the browser meanwhile, or someone else.
  if (!current || pausedFor !== userId) {
    await dropWebPush();
    return false;
  }
  try {
    await saveDevice(current);
  } catch (err) {
    // The server said no, like too many devices: stays off. Offline: the next open
    // tries again.
    if (err instanceof ApiError) store(PAUSED_FOR_KEY, null);
    throw err;
  }
  store(PAUSED_FOR_KEY, null);
  return true;
}

// Run when the app opens. If the browser replaced its subscription, moves this device to
// the new one. Tells the server once whether the device is on a Mac, for devices saved
// before it asked. A device removed from another device stays removed. Returns true if
// it changed the device.
export async function recheckPush(): Promise<boolean> {
  const current = await currentSubscription();
  if (!current) return false;
  const saved = stored(SAVED_ENDPOINT_KEY);
  const macSent = stored(MAC_SENT_KEY) === current.endpoint;
  if (current.endpoint === saved && macSent) return false;

  const { subscriptions } = await api<PushSubscriptionsResponse>(
    "/push/subscriptions",
  );
  const mine = subscriptions.find(
    (device) => device.endpoint === current.endpoint,
  );
  // Saved before this browser remembered its endpoint, or whether it's on a Mac.
  const old = mine ?? subscriptions.find((device) => device.endpoint === saved);
  if (!old) return false;
  const moved = !mine;
  if (moved || !macSent) {
    await api(`/push/subscriptions/${old.id}`, {
      method: "PATCH",
      body: {
        onMac: onMac(),
        ...(moved && { subscription: current.toJSON() }),
      },
    });
  }
  store(SAVED_ENDPOINT_KEY, current.endpoint);
  store(MAC_SENT_KEY, current.endpoint);
  return moved;
}
