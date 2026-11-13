import type { AppleTestResponse, TestAlertResponse } from "@pr-peek/core";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "../../api";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import styles from "./AdminPage.module.css";
import { AdminSection } from "./AdminSection";

// The Admin page's Tests tab: notifications sent to the admin's own devices.
export function AdminTests() {
  return (
    <div className={styles.stack}>
      <TestSection
        title="Admin alert"
        hint="One alert like the ones about Git Buddy itself, to each of your devices."
        button="Send a test alert"
        send={() =>
          api<TestAlertResponse>("/admin/test-alert", { method: "POST" })
        }
        result={({ sent }) =>
          sent
            ? "Sent. Check your phone."
            : "None of your devices took it. Turn on notifications in Settings, Notifications."
        }
      />
      {/* Plan 12: checks each kind's tile in the iPhone app. */}
      <TestSection
        title="iPhone app"
        hint="One of each kind of notification, with your picture, to your iPhone apps. Then a plain one, like the morning summary."
        button="Send to my iPhones"
        send={() =>
          api<AppleTestResponse>("/apple-devices/test", { method: "POST" })
        }
        result={iphoneResult}
        error={iphoneError}
      />
    </div>
  );
}

// A button that sends a test, then says what happened.
function TestSection<Answer>({
  title,
  hint,
  button,
  send,
  result,
  error = (err) => err.message,
}: {
  title: string;
  hint: string;
  button: string;
  send: () => Promise<Answer>;
  result: (answer: Answer) => string;
  error?: (err: Error) => string;
}) {
  const test = useMutation({ mutationFn: send });
  return (
    <AdminSection title={title} hint={hint}>
      <div className={styles.actions}>
        <Button onClick={() => test.mutate()} disabled={test.isPending}>
          {button}
        </Button>
        <p className={styles.hint} role="status">
          {test.isSuccess && result(test.data)}
        </p>
      </div>
      {test.isError && <Alert>{error(test.error)}</Alert>}
    </AdminSection>
  );
}

function iphoneResult({ sent, failed }: AppleTestResponse) {
  if (sent === 0) return "Apple couldn't deliver them. Try again later.";
  const phones = sent === 1 ? "1 iPhone" : `${sent} iPhones`;
  const missed = failed > 0 ? ` ${failed} didn't take them.` : "";
  return `Sent to ${phones}. They arrive in a few seconds.${missed}`;
}

// The server has no iPhone app for this account yet.
function iphoneError(err: Error) {
  return err instanceof ApiError && err.status === 404
    ? "None of your iPhones has notifications on. Turn them on in the app's Settings, Notifications."
    : err.message;
}
