import { useEffect } from "react";
import { Outlet } from "react-router";
import { api } from "../api";
import { setAppBadge } from "../appBadge";
import {
  coloredIcon,
  countStyle,
  HEARTBEAT_MS,
  inDesktopApp,
  setTrayState,
} from "../desktop";
import { useIosPush } from "../hooks/useIosPush";
import { useLiveUpdates } from "../hooks/useLiveUpdates";
import { useLocalSetting } from "../localSetting";
import { recheckPush } from "../push";
import { useReloadDevices, useSummary } from "../queries";

// Wraps every signed in page. Keeps the list, the app badge, the Mac menu bar, and this
// device's notifications current, in the iPhone app too.
export function SignedIn() {
  useLiveUpdates();
  useIosPush();
  const summary = useSummary().data;
  const style = useLocalSetting(countStyle);
  const colored = useLocalSetting(coloredIcon);
  useEffect(() => {
    if (!summary) return;
    void setAppBadge(summary.total);
    setTrayState(summary, style, colored);
  }, [summary, style, colored]);

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
