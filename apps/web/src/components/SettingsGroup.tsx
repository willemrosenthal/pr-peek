import type { ReactNode } from "react";
import { Card } from "./Card";
import styles from "./SettingsGroup.module.css";

// A titled card of settings rows.
export function SettingsGroup({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.group}>
      <h3 className={styles.title}>{title}</h3>
      {hint && <p className={styles.hint}>{hint}</p>}
      <Card label={title}>{children}</Card>
    </section>
  );
}
