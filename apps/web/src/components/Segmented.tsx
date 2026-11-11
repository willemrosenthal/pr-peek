import { useId } from "react";
import { cx } from "../cx";
import type { Choice } from "./choice";
import styles from "./Segmented.module.css";

// A few choices side by side in a gray track, like the phone's own. Real radio buttons
// underneath, so arrow keys move between them and screen readers hear a group.
export function Segmented<Value extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  // The group's name for screen readers.
  label: string;
  value: Value;
  options: readonly Choice<Value>[];
  onChange: (value: Value) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <div className={styles.track} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label
          key={option.value}
          className={cx(
            styles.segment,
            option.value === value && styles.picked,
          )}
        >
          <input
            type="radio"
            className="visually-hidden"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            disabled={disabled}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
