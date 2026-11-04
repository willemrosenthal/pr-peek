import { useEffect } from "react";
import { useSearchParams } from "react-router";

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

// True in the dropdown under the icon.
export const useIsDropdown = () => useShell() === "tray";

// The same as useIsDropdown, outside React, like at startup.
export const inDropdown = () =>
  shellOf(new URLSearchParams(location.search).get("shell")) === "tray";

// Saves the shell from the page's own URL, before anything renders. Signing in starts on
// a page that doesn't read it, and GitHub sends the user back without it.
export function rememberShell() {
  const fromUrl = new URLSearchParams(location.search).get("shell");
  if (fromUrl !== null) storeShell(fromUrl);
}

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
