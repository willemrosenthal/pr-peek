import { useEffect } from "react";
import { inDesktopApp } from "../desktop";
import { isStandalone } from "../install";

// Calls `onHide` whenever the app is hidden or minimized, so it opens fresh next time.
// Only in the Mac app and the installed app. A browser tab stays as it was.
// `onHide` should keep its identity between renders.
export function useWhenHidden(onHide: () => void) {
  useEffect(() => {
    if (!inDesktopApp() && !isStandalone()) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };

    // The Mac app's window can hide while the page still counts as visible.
    window.addEventListener("pr-peek:hidden", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pr-peek:hidden", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [onHide]);
}
