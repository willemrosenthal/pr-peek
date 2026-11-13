import type { PushPayload } from "@pr-peek/core";
import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { setBadge } from "../badge";
import { notificationLink } from "../notificationLink";

declare const self: ServiceWorkerGlobalScope;

// Keeps the app's files (HTML, scripts, styles, icons) so it opens instantly.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// App pages open the kept index.html. The API, including GitHub sign in, always goes to
// the server and is never cached.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//],
  }),
);

type NotificationData = Pick<PushPayload, "url" | "itemId">;

self.addEventListener("push", (event) => {
  const payload = event.data?.json() as PushPayload | undefined;
  if (!payload) return;
  const { itemId, badge } = payload;
  const data: NotificationData = {
    url: notificationLink(payload),
    ...(itemId && { itemId }),
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, {
        body: payload.body,
        tag: payload.tag,
        icon: payload.icon ?? "/pwa-192x192.png",
        data,
      }),
      badge !== undefined && setBadge(badge),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url, itemId } = event.notification.data as NotificationData;
  event.waitUntil(openFromNotification(url, itemId));
});

// Opens the window before marking the item seen. Browsers can refuse to open one after
// waiting on the network.
async function openFromNotification(url: string, itemId?: string) {
  try {
    await openWindow(new URL(url, self.location.origin));
  } finally {
    if (itemId) await markSeen(itemId);
  }
}

// pr-peek links go to an open app window. Only windows this worker controls can be sent
// somewhere else. Other links open a new window, so the app stays where it was.
async function openWindow(target: URL) {
  const [appWindow] = await self.clients.matchAll({ type: "window" });
  if (target.origin === self.location.origin && appWindow) {
    await appWindow.focus();
    await appWindow.navigate(target.href);
  } else {
    await self.clients.openWindow(target.href);
  }
}

async function markSeen(itemId: string) {
  await fetch("/api/items/seen", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [itemId] }),
  }).catch(() => undefined);
}

// The page asks for this when the user clicks Reload on "New version available".
self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});
// Takes over open pages once active, which tells them to reload into the new version.
clientsClaim();
