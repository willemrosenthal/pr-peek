import type { AppleDeviceResponse } from "@pr-peek/core";
import { api } from "./api";
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
  const { PushNotifications, PrPeek } = await loadNative();
  const handles = await Promise.all([
    PushNotifications.addListener("registration", ({ value }) => {
      // The next open tries again.
      saveToken(value, () => PrPeek.build()).catch(() => undefined);
    }),
    PushNotifications.addListener(
      "pushNotificationActionPerformed",
      ({ notification }) => openTapped(notification.data as TapData, open),
    ),
  ]);
  // Each time, so the server always has the phone's current token. Apple can change it.
  const { receive } = await PushNotifications.checkPermissions();
  if (receive === "granted") await PushNotifications.register();
  return () => {
    for (const handle of handles) void handle.remove();
  };
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
// the token again.
export async function forgetIosPush() {
  const token = stored(TOKEN_KEY);
  if (!token) return;
  // Already gone is fine, like after Apple said the app was removed.
  await api(`/apple-devices/${token}`, { method: "DELETE" }).catch(
    () => undefined,
  );
  store(TOKEN_KEY, null);
}

async function saveToken(
  token: string,
  build: () => Promise<{ sandbox: boolean }>,
) {
  const { sandbox } = await build();
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
