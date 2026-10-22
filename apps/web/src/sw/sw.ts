import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

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

// The page asks for this when the user clicks Reload on "New version available".
self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});
// Takes over open pages once active, which tells them to reload into the new version.
clientsClaim();
