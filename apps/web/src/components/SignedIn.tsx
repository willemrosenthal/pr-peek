import { useEffect } from "react";
import { Outlet } from "react-router";
import { setBadge } from "../badge";
import { useLiveUpdates } from "../hooks/useLiveUpdates";
import { recheckPush } from "../push";
import { useReloadDevices, useSummary } from "../queries";

// Wraps every signed in page. Keeps the list, the app badge, and this device's
// notifications current.
export function SignedIn() {
  useLiveUpdates();
  const total = useSummary().data?.total;
  useEffect(() => {
    if (total !== undefined) void setBadge(total);
  }, [total]);

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
