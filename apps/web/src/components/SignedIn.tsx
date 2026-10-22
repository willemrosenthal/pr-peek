import { useEffect } from "react";
import { Outlet } from "react-router";
import { setBadge } from "../badge";
import { useLiveUpdates } from "../hooks/useLiveUpdates";
import { useSummary } from "../queries";

// Wraps every signed in page. Keeps the list and the app badge current.
export function SignedIn() {
  useLiveUpdates();
  const total = useSummary().data?.total;
  useEffect(() => {
    if (total !== undefined) setBadge(total);
  }, [total]);
  return <Outlet />;
}
