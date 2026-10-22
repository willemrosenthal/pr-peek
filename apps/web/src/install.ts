// Chrome and Edge's install offer. Not in TypeScript's DOM types yet.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface InstallState {
  // The browser's install offer, ready to show. Each one can be shown once.
  offer: BeforeInstallPromptEvent | null;
  // Installed while this page was open.
  installed: boolean;
}

const initial: InstallState = { offer: null, installed: false };
let state = initial;
const listeners = new Set<() => void>();

function update(next: Partial<InstallState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

// Chrome sends the offer once, soon after the app loads, so main.tsx imports this
// file to start listening before anyone opens the install page.
window.addEventListener("beforeinstallprompt", (event) => {
  // Stops Chrome's own install banner, so we can offer it from our button.
  event.preventDefault();
  update({ offer: event as BeforeInstallPromptEvent });
});
window.addEventListener("appinstalled", () => {
  update({ offer: null, installed: true });
});

export function subscribeInstall(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getInstallState = () => state;

// Shows the browser's install dialog.
export async function promptInstall() {
  const { offer } = state;
  if (!offer) return;
  update({ offer: null });
  try {
    await offer.prompt();
    const { outcome } = await offer.userChoice;
    if (outcome === "accepted") update({ installed: true });
  } catch {
    // The browser refused to show it. The manual steps show instead.
  }
}

export function resetInstall() {
  state = initial;
}

export type Platform = "ios" | "mac-safari" | "chromium" | "other";

// Which install steps fit this browser.
export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPads say they're Macs, but Macs have no touch screen.
  if (
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  ) {
    return "ios";
  }
  // Chrome and Edge also say "Safari", so check for them first. Android browsers
  // all install from their menu, like Chrome.
  if (/Chrome|Chromium|Edg\/|Android/.test(ua)) return "chromium";
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Firefox/.test(ua)) {
    return "mac-safari";
  }
  return "other";
}

// True when running as the installed app, not in a browser tab.
export function isStandalone(): boolean {
  const iosStandalone = (navigator as { standalone?: boolean }).standalone;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    iosStandalone === true
  );
}
