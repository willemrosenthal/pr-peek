import { useEffect } from "react";
import { Outlet } from "react-router";
import { setBadge } from "../badge";
import { api } from "../api";
import { HEARTBEAT_MS, inDesktopApp, setTrayState } from "../desktop";
import { useCountStyle } from "../hooks/useCountStyle";
import { useLiveUpdates } from "../hooks/useLiveUpdates";
import { recheckPush } from "../push";
import { useReloadDevices, useSummary } from "../queries";

// Wraps every signed in page. Keeps the list, the app badge, the Mac menu bar, and this
// device's notifications current.
export function SignedIn() {
  useLiveUpdates();
  const summary = useSummary().data;
  const countStyle = useCountStyle();
  useEffect(() => {
    if (!summary) return;
    void setBadge(summary.total);
    setTrayState(summary, countStyle);
  }, [summary, countStyle]);

  // Inside the Mac menu bar app, tells the server it's running.
  useEffect(() => {
    if (!inDesktopApp()) return;
    const beat = () => {
      api("/desktop/heartbeat", { method: "POST" }).catch(() => undefined);
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, []);

  const reloadDevices = useReloadDevices();
  useEffect(() => {
    recheckPush()
      .then(async (changed) => {
        if (changed) await reloadDevices();
      })
      // The next open tries again.
      .catch(() => undefined);
  }, [reloadDevices]);
  return <Outlet />;
}
