import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import styles from "./Field.module.css";

// A labelled text input.
export function TextField({
  label,
  ...props
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input className={styles.input} {...props} />
    </label>
  );
}

// A labelled dropdown. Children are its options.
export function SelectField({
  label,
  ...props
}: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select className={styles.input} {...props} />
    </label>
  );
}
