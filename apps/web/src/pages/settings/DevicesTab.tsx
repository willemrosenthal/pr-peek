import { Link } from "react-router";
import { useIsTray } from "../../hooks/useIsTray";
import { TabHeading } from "./SettingsLayout";

// Filled in by plan 08, with push notifications.
export function DevicesTab() {
  const isTray = useIsTray();
  return (
    <>
      <TabHeading title="Devices">
        Push notifications are coming soon. You'll turn them on and manage your
        devices here.
      </TabHeading>
      {!isTray && (
        <p>
          <Link to="/install">Install pr-peek on your devices</Link>
        </p>
      )}
    </>
  );
}
