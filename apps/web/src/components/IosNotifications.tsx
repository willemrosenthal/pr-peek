import { useIosPushSetup, type IosPushSetup } from "../hooks/useIosPushSetup";
import { Alert } from "./Alert";
import { Button } from "./Button";
import styles from "./Notifications.module.css";

// Notifications on this iPhone, in the app (plan 12): a Turn on button, On, or the way
// to iPhone Settings when they were turned off there. The Admin page sends a test.
export function IosNotifications() {
  const push = useIosPushSetup();
  return (
    <div className={styles.turnOn}>
      <Status push={push} />
      {/* Even once allowed, registering can fail. iOS's own message isn't for people.
          The next open tries again. */}
      {push.turnOnError && (
        <Alert>
          Couldn't turn on notifications. Close the app and open it again to try
          again.
        </Alert>
      )}
    </div>
  );
}

function Status({ push }: { push: IosPushSetup }) {
  switch (push.status) {
    case undefined:
      return null;
    case "unavailable":
      return (
        <p className={styles.hint}>This iPhone can't get notifications.</p>
      );
    case "off":
      return (
        <Button
          variant="primary"
          disabled={push.turningOn}
          onClick={push.turnOn}
        >
          Turn on notifications
        </Button>
      );
    case "blocked":
      return (
        <>
          <p className={styles.hint}>
            Notifications are turned off for Git Buddy in iPhone Settings.
          </p>
          <Button onClick={push.openSettings}>Open iPhone Settings</Button>
        </>
      );
    case "on":
      return <p>Notifications are on for this iPhone.</p>;
  }
}
