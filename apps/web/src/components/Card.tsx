import type { ReactNode } from "react";
import styles from "./Card.module.css";

// A box of rows with dividers, as in the settings mockup.
export function Card({
  children,
  label,
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <ul className={styles.card} aria-label={label}>
      {children}
    </ul>
  );
}

export function CardRow({ children }: { children: ReactNode }) {
  return <li className={styles.row}>{children}</li>;
}
