import type { AppleTestResponse } from "@pr-peek/core";
import { ApiError } from "../api";
import { useIosPushSetup } from "../hooks/useIosPushSetup";
import { Alert } from "./Alert";
import { Button } from "./Button";
import styles from "./Notifications.module.css";

// Notifications on this iPhone, in the app (plan 12): a Turn on button, On with a test,
// or the way to iPhone Settings when they were turned off there.
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
      return (
        <div className={styles.turnOn}>
          <p>Notifications are on for this iPhone.</p>
          <Button
            disabled={push.test.isPending}
            onClick={() => push.test.mutate()}
          >
            Send a test
          </Button>
          {push.test.isSuccess && (
            <p className={styles.hint} role="status">
              {testResult(push.test.data)}
            </p>
          )}
          {push.test.isError && <Alert>{testError(push.test.error)}</Alert>}
        </div>
      );
  }
}

function testResult({ sent }: AppleTestResponse) {
  return sent > 0
    ? "Sent. Each kind of notification arrives in a few seconds."
    : "Apple couldn't deliver it. Try again later.";
}

// The server has no iPhone for this account: saving the token failed, or hasn't
// finished. The app saves it each time it opens.
function testError(error: Error) {
  return error instanceof ApiError && error.status === 404
    ? "Git Buddy doesn't have this iPhone yet. Close the app, open it again, then try again."
    : error.message;
}
