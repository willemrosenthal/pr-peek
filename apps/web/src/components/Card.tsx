import type { ReactNode } from "react";
import { cx } from "../cx";
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

export function CardRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return <li className={cx(styles.row, className)}>{children}</li>;
}
