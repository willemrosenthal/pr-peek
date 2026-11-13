import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { haptic } from "../haptics";
import styles from "./Switch.module.css";

export function Switch({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  // Read by screen readers. Rows show their own visible text.
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <BaseSwitch.Root
      className={styles.root}
      aria-label={label}
      checked={checked}
      onCheckedChange={(next) => {
        haptic("selection");
        onChange(next);
      }}
      disabled={disabled}
    >
      <BaseSwitch.Thumb className={styles.thumb} />
    </BaseSwitch.Root>
  );
}
