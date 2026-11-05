import { useEffect, type ReactNode } from "react";
import styles from "./Toast.module.css";

// How long a toast stays.
export const TOAST_MS = 5_000;

export interface ToastMessage {
  text: ReactNode;
  // A button that undoes what the toast is about, like "Undo".
  action?: { label: string; onClick: () => void };
}

// A short message at the bottom of the screen that goes away on its own. One at a time:
// a new one replaces the last. Read out by screen readers.
export function Toast({
  toast,
  onDone,
}: {
  toast: ToastMessage | null;
  onDone: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDone, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, onDone]);

  return (
    <div className={styles.region} role="status">
      {toast && (
        <div className={styles.toast}>
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
