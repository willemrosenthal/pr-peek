import { useEffect, useState, type ReactNode } from "react";
import { cx } from "../cx";
import styles from "./Toast.module.css";

// How long a toast stays: long enough to read, or longer with a button to tap.
export const TOAST_MS = 3_000;
export const ACTION_TOAST_MS = 5_000;
// The last part of that, when it slides away (`.leaving` in Toast.module.css).
const LEAVE_MS = 200;

export interface ToastMessage {
  text: ReactNode;
  // A button that undoes what the toast is about, like "Undo".
  action?: { label: string; onClick: () => void };
}

// A short message at the bottom of the screen that slides in and goes away on its own.
// One at a time: a new one replaces the last. Read out by screen readers.
export function Toast({
  toast,
  onDone,
}: {
  toast: ToastMessage | null;
  onDone: () => void;
}) {
  // The toast that's sliding away. A new one isn't, until its own time is up.
  const [leaving, setLeaving] = useState<ToastMessage | null>(null);

  useEffect(() => {
    if (!toast) return;
    const ms = toast.action ? ACTION_TOAST_MS : TOAST_MS;
    const leave = setTimeout(() => setLeaving(toast), ms - LEAVE_MS);
    const done = setTimeout(onDone, ms);
    return () => {
      clearTimeout(leave);
      clearTimeout(done);
    };
  }, [toast, onDone]);

  return (
    <div className={styles.region} role="status">
      {toast && (
        <div className={cx(styles.toast, leaving === toast && styles.leaving)}>
          <span className={styles.text}>{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                toast.action?.onClick();
                onDone();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
