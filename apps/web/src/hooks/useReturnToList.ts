import { useEffect } from "react";
import { useNavigate } from "react-router";
import { inDesktopApp } from "../desktop";
import { isStandalone } from "../install";

// Goes back to the list whenever the app is hidden or minimized, so it always opens
// there. Only in the Mac app and the installed app. A browser tab stays where it was.
export function useReturnToList() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!inDesktopApp() && !isStandalone()) return;
    const leave = () => void navigate("/");
    const onVisibility = () => {
      if (document.visibilityState === "hidden") leave();
    };

    // The Mac app's window can hide while the page still counts as visible.
    window.addEventListener("pr-peek:hidden", leave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pr-peek:hidden", leave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [navigate]);
}
