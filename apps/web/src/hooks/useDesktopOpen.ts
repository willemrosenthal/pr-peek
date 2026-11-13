import { useEffect } from "react";
import { useNavigate } from "react-router";
import { pageToOpen } from "../desktop";

// In the Mac app: goes to the page a clicked notification asks for, like a PR's preview.
export function useDesktopOpen() {
  const navigate = useNavigate();
  useEffect(() => {
    const onOpen = (event: Event) => {
      const path = pageToOpen(event);
      if (path) void navigate(path);
    };
    window.addEventListener("pr-peek:open", onOpen);
    return () => window.removeEventListener("pr-peek:open", onOpen);
  }, [navigate]);
}
