import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { isStandalone } from "../install";

const KEY = "pr-peek:shell";

// The Mac menu bar app opens the page with `?shell=tray` in the dropdown under its icon,
// and `?shell=window` once popped out into a window. Kept for the session, so it holds
// on other pages and after a reload.
const shellOf = (fromUrl: string | null) => fromUrl ?? readStored();

// The shell from the router's URL, kept for the session.
function useShell(): string | null {
  const [params] = useSearchParams();
  const fromUrl = params.get("shell");

  useEffect(() => {
    if (fromUrl !== null) storeShell(fromUrl);
  }, [fromUrl]);

  return shellOf(fromUrl);
}

// True in the Mac menu bar app, in the dropdown or popped out.
export function useIsTray(): boolean {
  const shell = useShell();
  return shell === "tray" || shell === "window";
}

// True in the iPhone app (plan 12), which opens the site with `?shell=ios`.
export const useInIosApp = () => useShell() === "ios";

// The same as useInIosApp, outside React, like at startup.
export const inIosApp = () => shellOf(shellInUrl()) === "ios";

// True in an app that notifies on its own: the Mac menu bar app or the iPhone app. They
// don't need installing, or the web's notifications.
export const useInNativeApp = () => {
  const shell = useShell();
  return shell === "tray" || shell === "window" || shell === "ios";
};

// True in the installed web app, on a phone or a computer, where notifications are set
// up. Not the native apps, which notify on their own.
export const useInInstalledApp = () => !useInNativeApp() && isStandalone();

// True in the dropdown under the icon.
export const useIsDropdown = () => useShell() === "tray";

// The same as useIsDropdown, outside React, like at startup.
export const inDropdown = () => shellOf(shellInUrl()) === "tray";

// Saves the shell from the page's own URL, before anything renders. Signing in starts on
// a page that doesn't read it, and GitHub sends the user back without it.
export function rememberShell() {
  const fromUrl = shellInUrl();
  if (fromUrl !== null) storeShell(fromUrl);
}

// The shell in the page's own URL, outside React.
const shellInUrl = () => new URLSearchParams(location.search).get("shell");

function storeShell(shell: string) {
  try {
    sessionStorage.setItem(KEY, shell);
  } catch {
    // Blocked storage only loses the flag on other pages.
  }
}

function readStored(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
