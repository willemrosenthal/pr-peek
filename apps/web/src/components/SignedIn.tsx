import { useEffect } from "react";
import { Outlet } from "react-router";
import { setBadge } from "../badge";
import { setTrayState } from "../desktop";
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
