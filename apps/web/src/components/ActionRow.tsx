import { cx } from "../cx";
import styles from "./ActionRow.module.css";
import { CardRow } from "./Card";

// A row of a Group that's one centered button, like Sign out. `danger` is red, for
// things that delete.
export function ActionRow({
  label,
  onClick,
  disabled = false,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <CardRow className={styles.row}>
      <button
        type="button"
        className={cx(styles.action, danger && styles.danger)}
        onClick={onClick}
        disabled={disabled}
      >
        {label}
      </button>
    </CardRow>
  );
}
