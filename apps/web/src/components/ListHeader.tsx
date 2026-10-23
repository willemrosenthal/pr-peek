import { formatAge } from "@pr-peek/core";
import { RotateCw, Settings } from "lucide-react";
import { useEffect, useRef, type MouseEvent } from "react";
import { Link } from "react-router";
import { cx } from "../cx";
import { inDesktopApp, popOut } from "../desktop";
import { useIsDropdown } from "../hooks/useIsTray";
import { useNow } from "../hooks/useNow";
import styles from "./ListHeader.module.css";
import { Mascot } from "./RainbowIcon";

// How far the header moves before the dropdown pops out.
const POP_OUT_DRAG_PX = 20;

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
  const startDrag = usePopOutDrag();
  return (
    <header
      className={cx(styles.header, canPopOut && styles.draggable)}
      onMouseDown={canPopOut ? startDrag : undefined}
    >
      <div
        className={styles.text}
        title={canPopOut ? "Drag to pop out into a window" : undefined}
      >
        <h1 className={styles.title}>
          <Mascot />
          Git Buddy
        </h1>
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

// Pops the dropdown out into a window once a drag on the header goes far enough.
function usePopOutDrag() {
  const stop = useRef<() => void>(undefined);
  useEffect(() => () => stop.current?.(), []);

  return (event: MouseEvent) => {
    const onControl = (event.target as Element).closest("button, a");
    if (event.button !== 0 || onControl) return;
    const { clientX, clientY } = event;
    const move = (moved: globalThis.MouseEvent) => {
      const distance = Math.hypot(
        moved.clientX - clientX,
        moved.clientY - clientY,
      );
      if (distance < POP_OUT_DRAG_PX) return;
      end();
      popOut();
    };
    const end = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
      stop.current = undefined;
    };
    stop.current?.();
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    stop.current = end;
  };
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
