import type {
  ComponentProps,
  InputHTMLAttributes,
  SelectHTMLAttributes,
} from "react";
import { cx } from "../cx";
import styles from "./Field.module.css";

// A labelled text input.
export function TextField({
  label,
  ...props
}: { label: string } & ComponentProps<"input">) {
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
      <Select {...props} />
    </label>
  );
}

// A text box without its own label, for rows that label it another way.
export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(styles.input, className)} {...props} />;
}

// A dropdown without its own label, for rows that label it another way.
export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(styles.input, className)} {...props} />;
}
