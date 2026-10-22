import type { ReactNode } from "react";
import styles from "./PageMessage.module.css";

// A centered message that fills the page, for loading and error states.
export function PageMessage({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <main className={styles.page} aria-live="polite">
      <h1 className={styles.title}>{title}</h1>
      {children}
    </main>
  );
}
