import { formatAge } from "@pr-peek/core";
import { PictureInPicture2, RotateCw, Settings } from "lucide-react";
import { Link } from "react-router";
import { cx } from "../cx";
import { inDesktopApp, popOut } from "../desktop";
import { useIsDropdown } from "../hooks/useIsTray";
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
  const canPopOut = useIsDropdown() && inDesktopApp();
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
      {canPopOut && (
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Pop out into a window"
          title="Pop out into a window"
          onClick={popOut}
        >
          <PictureInPicture2 />
        </button>
      )}
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
