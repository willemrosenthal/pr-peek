import { useEffect } from "react";
import { useNavigate } from "react-router";
import { inDesktopApp } from "../desktop";
import { isStandalone } from "../install";

// Time away before the page goes back to the list. Long enough to make a token on GitHub.
export const AWAY_MS = 2 * 60_000;

// Goes back to the list when the app comes back after a while away. Only in the Mac app
// and the installed app. A browser tab stays where it was.
export function useReturnToList() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!inDesktopApp() && !isStandalone()) return;
    let leftAt: number | null = null;
    const leave = () => {
      leftAt = Date.now();
    };
    // Checks the time on return, since timers stop while a phone app is in the background.
    const back = () => {
      if (leftAt !== null && Date.now() - leftAt >= AWAY_MS) void navigate("/");
      leftAt = null;
    };
    const onVisibility = () =>
      document.visibilityState === "hidden" ? leave() : back();

    // The Mac app's window can hide while the page still counts as visible.
    window.addEventListener("pr-peek:hidden", leave);
    window.addEventListener("pr-peek:shown", back);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pr-peek:hidden", leave);
      window.removeEventListener("pr-peek:shown", back);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [navigate]);
}
