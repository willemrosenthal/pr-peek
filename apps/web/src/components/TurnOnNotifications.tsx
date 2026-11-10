import { usePushSetup } from "../hooks/usePushSetup";
import { Alert } from "./Alert";
import { Button } from "./Button";
import styles from "./Notifications.module.css";

// Turns on notifications for this device, or says why it can't. For the installed app.
export function TurnOnNotifications() {
  const push = usePushSetup();

  switch (push.status) {
    case undefined:
      return null;
    case "unavailable":
      return (
        <p className={styles.hint}>This device can't get notifications.</p>
      );
    case "on":
      return <p>Notifications are on for this device.</p>;
    case "blocked":
      return (
        <p className={styles.hint}>
          Notifications are blocked for Git Buddy. Allow them in this device's
          settings, then reload.
        </p>
      );
    case "off":
      return (
        <div className={styles.turnOn}>
          <Button
            variant="primary"
            disabled={!push.turnOn || push.turningOn}
            onClick={push.turnOn}
          >
            Turn on notifications
          </Button>
          {push.error && <Alert>{push.error.message}</Alert>}
        </div>
      );
  }
}
