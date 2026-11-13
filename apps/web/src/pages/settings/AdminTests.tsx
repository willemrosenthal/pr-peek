import type { AppleTestResponse, TestAlertResponse } from "@pr-peek/core";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "../../api";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import styles from "./AdminPage.module.css";

// The Admin page's Tests tab: notifications sent to the admin's own devices.
export function AdminTests() {
  return (
    <div className={styles.overview}>
      <TestAlert />
      <IphoneTest />
    </div>
  );
}

function TestAlert() {
  const send = useMutation({
    mutationFn: () =>
      api<TestAlertResponse>("/admin/test-alert", { method: "POST" }),
  });
  return (
    <section className={styles.section} aria-label="Admin alert">
      <h3 className={styles.sectionTitle}>Admin alert</h3>
      <p className={styles.hint}>
        One alert like the ones about Git Buddy itself, to each of your devices.
      </p>
      <div className={styles.actions}>
        <Button onClick={() => send.mutate()} disabled={send.isPending}>
          Send a test alert
        </Button>
        <p className={styles.hint} role="status">
          {send.data &&
            (send.data.sent
              ? "Sent. Check your phone."
              : "None of your devices took it. Turn on notifications in Devices.")}
        </p>
      </div>
      {send.isError && <Alert>{send.error.message}</Alert>}
    </section>
  );
}

// One of each kind of notification to your iPhone apps (plan 12), to check each tile.
function IphoneTest() {
  const send = useMutation({
    mutationFn: () =>
      api<AppleTestResponse>("/apple-devices/test", { method: "POST" }),
  });
  return (
    <section className={styles.section} aria-label="iPhone app">
      <h3 className={styles.sectionTitle}>iPhone app</h3>
      <p className={styles.hint}>
        One of each kind of notification, with your picture, to your iPhone
        apps. Then a plain one, like the morning summary.
      </p>
      <div className={styles.actions}>
        <Button onClick={() => send.mutate()} disabled={send.isPending}>
          Send to my iPhones
        </Button>
        <p className={styles.hint} role="status">
          {send.data && iphoneResult(send.data)}
        </p>
      </div>
      {send.isError && <Alert>{iphoneError(send.error)}</Alert>}
    </section>
  );
}

function iphoneResult({ sent, failed }: AppleTestResponse) {
  if (sent === 0) return "Apple couldn't deliver them. Try again later.";
  const phones = sent === 1 ? "1 iPhone" : `${sent} iPhones`;
  const missed = failed > 0 ? ` ${failed} didn't take them.` : "";
  return `Sent to ${phones}. They arrive in a few seconds.${missed}`;
}

// The server has no iPhone app for this account yet.
function iphoneError(error: Error) {
  return error instanceof ApiError && error.status === 404
    ? "None of your iPhones has notifications on. Turn them on in the app's Settings, Notifications."
    : error.message;
}
