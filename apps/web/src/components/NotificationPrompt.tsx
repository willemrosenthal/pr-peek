import { usePushSetup } from "../hooks/usePushSetup";
import { useStoredState } from "../hooks/useStoredState";
import { Alert } from "./Alert";
import { Button } from "./Button";
import styles from "./Notifications.module.css";
import { TurnOnButton } from "./TurnOnNotifications";

const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

// Above the list in the installed app, until this device gets notifications. Most people
// set up in a browser first, so the app is where they turn them on. "Not now" hides it
// on this device. Settings, Notifications has the same button.
export function NotificationPrompt() {
  const push = usePushSetup();
  const [dismissed, setDismissed] = useStoredState(
    "pr-peek:notification-prompt-dismissed",
    false,
    isBoolean,
  );
  if (push.status !== "off" || dismissed) return null;

  return (
    <section className={styles.prompt} aria-label="Notifications">
      <p>Get a notification when a PR needs you.</p>
      <div className={styles.actions}>
        <TurnOnButton push={push} />
        <Button onClick={() => setDismissed(true)}>Not now</Button>
      </div>
      {push.error && <Alert>{push.error.message}</Alert>}
    </section>
  );
}
