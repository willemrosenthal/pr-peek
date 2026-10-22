import type { ReactNode } from "react";
import styles from "./Alert.module.css";

// An error message, read out by screen readers when it appears.
export function Alert({ children }: { children: ReactNode }) {
  return (
    <p className={styles.alert} role="alert">
      {children}
    </p>
  );
}
