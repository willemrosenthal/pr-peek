import { Select } from "@base-ui/react/select";
import { Check } from "lucide-react";
import styles from "./Picker.module.css";

export interface PickerOption<Value extends string> {
  value: Value;
  label: string;
}

// A short menu of choices, drawn by the app instead of the browser. With a mouse, the
// picked choice opens right over the button. On a phone, the menu opens below it. The
// browser's own menu takes the button's width, which is tiny for a chip, and lands in
// odd places in Chrome's phone view.
export function Picker<Value extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
}: {
  // Read by screen readers, like "Urgency for Mentioned me".
  label: string;
  value: Value;
  options: readonly PickerOption<Value>[];
  onChange: (value: Value) => void;
  disabled?: boolean;
  // The button's look. The menu has its own.
  className?: string | undefined;
}) {
  return (
    <Select.Root
      items={options}
      value={value}
      onValueChange={(picked) => {
        if (picked !== null) onChange(picked);
      }}
      disabled={disabled}
    >
      <Select.Trigger className={className} aria-label={label}>
        <Select.Value />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner className={styles.positioner} sideOffset={6}>
          <Select.Popup className={styles.popup}>
            <Select.List>
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  className={styles.item}
                >
                  <Select.ItemIndicator className={styles.check}>
                    <Check size={16} strokeWidth={2.5} aria-hidden="true" />
                  </Select.ItemIndicator>
                  <Select.ItemText className={styles.text}>
                    {option.label}
                  </Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
