import { formatAge } from "@pr-peek/core";
import { RotateCw, Settings } from "lucide-react";
import { Link } from "react-router";
import { cx } from "../cx";
import { useNow } from "../hooks/useNow";
import styles from "./ListHeader.module.css";

export function ListHeader({
  lastSyncedAt,
  refreshing,
  onRefresh,
}: {
  lastSyncedAt: string | null | undefined;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        <h1 className={styles.title}>Git Buddy</h1>
        <UpdatedAt lastSyncedAt={lastSyncedAt} />
      </div>
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Refresh"
        aria-busy={refreshing}
        disabled={refreshing}
        onClick={onRefresh}
      >
        <RotateCw className={cx(refreshing && styles.spin)} />
      </button>
      <Link to="/settings" className={styles.iconButton} aria-label="Settings">
        <Settings />
      </Link>
    </header>
  );
}

function UpdatedAt({
  lastSyncedAt,
}: {
  lastSyncedAt: string | null | undefined;
}) {
  const now = useNow();
  if (lastSyncedAt === undefined) return null;
  const age = lastSyncedAt && formatAge(lastSyncedAt, now);
  return (
    <span className={styles.updated}>
      {age === null
        ? "Not synced yet"
        : age === "0m"
          ? "Updated just now"
          : `Updated ${age} ago`}
    </span>
  );
}
