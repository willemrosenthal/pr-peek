import styles from "./RowText.module.css";

// A settings row's name, with an optional hint under it.
export function RowText({
  label,
  hint,
}: {
  label: string;
  hint?: string | undefined;
}) {
  return (
    <span className={styles.text}>
      <span className={styles.label}>{label}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
    </span>
  );
}
