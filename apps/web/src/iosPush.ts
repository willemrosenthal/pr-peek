import type { AppleDeviceResponse } from "@pr-peek/core";
import { api, ApiError } from "./api";
import { deviceLabel } from "./push";
import { store, stored } from "./storage";

// Push in the iPhone app (plan 12), through Apple's push service instead of web push.

const loadNative = () => import("./native");

// The token the server has for this phone, so signing out can remove it.
const TOKEN_KEY = "pr-peek:apple-token";

// What a notification carries for a tap (apns.ts).
interface TapData {
  url?: unknown;
  itemId?: unknown;
}

// Run once signed in. Saves the phone's token with the server, and handles taps on
// notifications: `open` moves the app to one of its own pages. Returns a function that
// stops it.
export async function startIosPush(
  open: (path: string) => void,
): Promise<() => void> {
  const { PushNotifications } = await loadNative();
  const handles = await Promise.all([
    PushNotifications.addListener("registration", ({ value }) => {
      // The next open tries again.
      saveToken(value).catch(() => undefined);
    }),
    PushNotifications.addListener(
      "pushNotificationActionPerformed",
      ({ notification }) => openTapped(notification.data as TapData, open),
    ),
  ]);
  const stop = () => {
    for (const handle of handles) void handle.remove();
  };
  // Each time, so the server always has the phone's current token. Apple can change it.
  try {
    const { receive } = await PushNotifications.checkPermissions();
    if (receive === "granted") await PushNotifications.register();
  } catch {
    // The next open tries again. Still returns `stop`, so the listeners never pile up.
  }
  return stop;
}

// "off" until asked, and "blocked" once turned off in iPhone Settings.
export type IosPushStatus = "off" | "on" | "blocked";

// Whether this iPhone allows notifications. When it does, startIosPush saves its token.
export async function iosPushStatus(): Promise<IosPushStatus> {
  const { PushNotifications } = await loadNative();
  const { receive } = await PushNotifications.checkPermissions();
  if (receive === "granted") return "on";
  return receive === "denied" ? "blocked" : "off";
}

// Opens Git Buddy's notification settings in iPhone Settings.
export async function openIosSettings() {
  const { PrPeek } = await loadNative();
  await PrPeek.openSettings();
}

// Asks for permission, then registers, which saves the token (startIosPush). Call it
// from a tap. False when notifications weren't allowed.
export async function turnOnIosPush(): Promise<boolean> {
  const { PushNotifications } = await loadNative();
  const { receive } = await PushNotifications.requestPermissions();
  if (receive !== "granted") return false;
  await PushNotifications.register();
  return true;
}

// Before signing out: the server stops sending to this phone. Signing in again saves
// the token again. Throws when the server couldn't remove it, like offline, so signing
// out stops and can be tried again with the token still known.
export async function forgetIosPush() {
  const token = stored(TOKEN_KEY);
  if (!token) return;
  try {
    await api(`/apple-devices/${token}`, { method: "DELETE" });
  } catch (err) {
    // Already gone is fine, like after Apple said the app was removed.
    if (!(err instanceof ApiError && err.status === 404)) throw err;
  }
  store(TOKEN_KEY, null);
}

async function saveToken(token: string) {
  const { PrPeek } = await loadNative();
  const { sandbox } = await PrPeek.build();
  await api<AppleDeviceResponse>("/apple-devices", {
    method: "POST",
    body: { token, label: deviceLabel(), sandbox },
  });
  store(TOKEN_KEY, token);
}

// Like the web's service worker: opens the notification's link, and marks its item seen.
// Git Buddy's own pages open in the app. PRs open in Safari, or the GitHub app.
function openTapped({ url, itemId }: TapData, open: (path: string) => void) {
  if (typeof itemId === "string") {
    api("/items/seen", { method: "POST", body: { ids: [itemId] } }).catch(
      () => undefined,
    );
  }
  if (typeof url !== "string") return;
  const target = new URL(url, location.origin);
  if (target.origin === location.origin) {
    open(target.pathname + target.search + target.hash);
  } else {
    window.open(target.href, "_blank");
  }
}
