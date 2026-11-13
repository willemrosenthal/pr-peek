import { useIosPushSetup } from "../hooks/useIosPushSetup";
import { Alert } from "./Alert";
import { Button } from "./Button";
import styles from "./Notifications.module.css";

// Notifications on this iPhone, in the app (plan 12): a Turn on button, On, or the way
// to iPhone Settings when they were turned off there. The Admin page sends a test.
export function IosNotifications() {
  const push = useIosPushSetup();

  switch (push.status) {
    case undefined:
      return null;
    case "unavailable":
      return (
        <p className={styles.hint}>This iPhone can't get notifications.</p>
      );
    case "off":
      return (
        <div className={styles.turnOn}>
          <Button
            variant="primary"
            disabled={push.turningOn}
            onClick={push.turnOn}
          >
            Turn on notifications
          </Button>
          {push.turnOnError && <Alert>{push.turnOnError.message}</Alert>}
        </div>
      );
    case "blocked":
      return (
        <div className={styles.turnOn}>
          <p className={styles.hint}>
            Notifications are turned off for Git Buddy in iPhone Settings.
          </p>
          <Button onClick={push.openSettings}>Open iPhone Settings</Button>
        </div>
      );
    case "on":
      return <p>Notifications are on for this iPhone.</p>;
  }
}
