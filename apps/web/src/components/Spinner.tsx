import styles from "./Spinner.module.css";

// A small spinning ring. Pair it with text that says what's happening.
export function Spinner() {
  return <span className={styles.spinner} aria-hidden="true" />;
}
