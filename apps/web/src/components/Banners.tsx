import type { MeResponse, SyncStatusResponse } from "@pr-peek/core";
import { Link } from "react-router";
import styles from "./Banners.module.css";

// Problems that stop or slow syncs, with what to do about each.
export function Banners({
  me,
  syncError,
}: {
  me: MeResponse | undefined;
  syncError: SyncStatusResponse["syncError"] | undefined;
}) {
  if (me?.needsReauth) {
    return (
      <p className={styles.banner} role="status">
        GitHub stopped accepting your sign in.{" "}
        <a href="/api/auth/github">Reconnect GitHub</a>
      </p>
    );
  }
  if (me?.githubToken?.invalid) {
    return (
      <p className={styles.banner} role="status">
        Your token stopped working, so syncs are paused.{" "}
        <Link to="/settings">Add a new token</Link>
      </p>
    );
  }
  if (syncError === "failed") {
    return (
      <p className={styles.banner} role="status">
        Sync problem. Retrying soon.
      </p>
    );
  }
  return null;
}
