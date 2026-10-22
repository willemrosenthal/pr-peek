import type { ReactNode } from "react";
import styles from "./Control.module.css";

// A control with a short visible name. Screen readers hear the control's own label,
// which names the row too.
export function Control({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <span className={styles.control}>
      <span aria-hidden="true">{name}</span>
      {children}
    </span>
  );
}

// Lays out a row's controls side by side.
export function Controls({ children }: { children: ReactNode }) {
  return <span className={styles.controls}>{children}</span>;
}
