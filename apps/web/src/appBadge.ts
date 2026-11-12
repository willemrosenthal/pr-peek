import { setBadge } from "./badge";
import { inIosApp } from "./hooks/useIsTray";

// The count on the app's icon, from the page: the iPhone app's own badge, or the web's
// (badge.ts, which the service worker also uses). 0 clears it.
export async function setAppBadge(count: number) {
  if (!inIosApp()) return setBadge(count);
  const { PrPeek } = await import("./native");
  // Fails before notifications are allowed. The next count tries again.
  await PrPeek.setBadge({ count }).catch(() => undefined);
}
