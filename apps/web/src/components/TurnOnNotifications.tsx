import { useMutation } from "@tanstack/react-query";
import { pushSupport, turnOnPush } from "../push";
import {
  isPushOff,
  useDevices,
  usePushKey,
  useReloadDevices,
  useThisDevice,
} from "../queries";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { InstallHere } from "./InstallSteps";
import styles from "./Notifications.module.css";

// Turns on notifications for the device this page is open on, or says why it can't.
export function TurnOnNotifications() {
  const support = pushSupport();
  const key = usePushKey(support === "supported");
  const devices = useDevices();
  const thisDevice = useThisDevice();
  const reloadDevices = useReloadDevices();
  const turnOn = useMutation({
    mutationFn: (publicKey: string) => turnOnPush(publicKey),
    onSuccess: reloadDevices,
  });

  // The iPhone steps say notifications need the Home Screen app.
  if (support === "needs-install") return <InstallHere />;
  if (support === "unsupported") {
    return <p className={styles.hint}>This browser can't get notifications.</p>;
  }
  if (isPushOff(key.error)) {
    return (
      <p className={styles.hint}>
        Notifications aren't set up on this server yet.
      </p>
    );
  }
  const isOn = devices.data?.subscriptions.some(
    (device) => device.endpoint === thisDevice.data,
  );
  if (isOn) return <p>Notifications are on for this device.</p>;
  if (Notification.permission === "denied") {
    return (
      <p className={styles.hint}>
        Notifications are blocked for Git Buddy. Allow them in this browser's
        settings for the site, then reload.
      </p>
    );
  }

  const error = turnOn.error ?? key.error;
  return (
    <div className={styles.turnOn}>
      <Button
        variant="primary"
        disabled={!key.data || turnOn.isPending}
        onClick={() => key.data && turnOn.mutate(key.data.publicKey)}
      >
        Turn on notifications
      </Button>
      {error && <Alert>{error.message}</Alert>}
    </div>
  );
}
