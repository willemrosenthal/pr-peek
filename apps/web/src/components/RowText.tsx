import { cx } from "../cx";
import styles from "./RowText.module.css";

// A settings row's name, with an optional hint under it. `full` puts the row's controls
// on the next line.
export function RowText({
  label,
  hint,
  full = false,
}: {
  label: string;
  hint?: string | undefined;
  full?: boolean;
}) {
  return (
    <span className={cx(styles.text, full && styles.full)}>
      <span className={styles.label}>{label}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
    </span>
  );
}
