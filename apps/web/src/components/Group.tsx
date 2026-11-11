import { useId, type ReactNode } from "react";
import { Card } from "./Card";
import styles from "./Group.module.css";

// A card of settings rows, with an optional title above it and a note below. Rows are
// CardRows, or with `box` anything else, like a list of its own.
export function Group({
  title,
  aside,
  label = title,
  footer,
  box = false,
  children,
}: {
  title?: string;
  // A few words on the title's right, like "This device".
  aside?: string;
  // The card's name for screen readers. The title, unless set.
  label?: string | undefined;
  footer?: ReactNode;
  box?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      className={styles.group}
      aria-labelledby={title ? titleId : undefined}
    >
      {title && (
        <h2 id={titleId} className={styles.title}>
          <span>{title}</span>
          {aside && <span className={styles.aside}>{aside}</span>}
        </h2>
      )}
      {box ? (
        <div className={styles.box}>{children}</div>
      ) : (
        <Card label={label} className={styles.card}>
          {children}
        </Card>
      )}
      {footer && <p className={styles.footer}>{footer}</p>}
    </section>
  );
}
