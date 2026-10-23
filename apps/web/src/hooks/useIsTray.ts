import { useEffect } from "react";
import { useSearchParams } from "react-router";

const KEY = "pr-peek:shell";

// True in the Mac menu bar app, which opens the page with `?shell=tray`. Kept for the
// session, so it holds on other pages and after a reload.
export function useIsTray(): boolean {
  const [params] = useSearchParams();
  const fromUrl = params.get("shell");

  useEffect(() => {
    if (fromUrl === null) return;
    try {
      sessionStorage.setItem(KEY, fromUrl);
    } catch {
      // Blocked storage only loses the flag on other pages.
    }
  }, [fromUrl]);

  return isTrayShell(fromUrl);
}

// The same check outside React, like at startup.
export const inTray = () =>
  isTrayShell(new URLSearchParams(location.search).get("shell"));

const isTrayShell = (fromUrl: string | null) =>
  (fromUrl ?? readStored()) === "tray";

function readStored(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
