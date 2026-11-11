import { Minus, Plus } from "lucide-react";
import styles from "./Stepper.module.css";

// − and + buttons around a value, like the phone's own. A null step turns its button off.
export function Stepper<Step>({
  value,
  less,
  more,
  lessLabel,
  moreLabel,
  onStep,
  disabled = false,
}: {
  // Shown between the buttons, like "24 h".
  value: string;
  less: Step | null;
  more: Step | null;
  // For screen readers, like "Turn orange sooner".
  lessLabel: string;
  moreLabel: string;
  onStep: (step: Step) => void;
  disabled?: boolean;
}) {
  return (
    <span className={styles.stepper}>
      <button
        type="button"
        className={styles.button}
        aria-label={lessLabel}
        onClick={() => less !== null && onStep(less)}
        disabled={disabled || less === null}
      >
        <Minus size={18} strokeWidth={2.5} aria-hidden="true" />
      </button>
      <output className={styles.value} aria-live="polite">
        {value}
      </output>
      <button
        type="button"
        className={styles.button}
        aria-label={moreLabel}
        onClick={() => more !== null && onStep(more)}
        disabled={disabled || more === null}
      >
        <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
      </button>
    </span>
  );
}
