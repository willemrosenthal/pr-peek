import { Popover } from "@base-ui/react/popover";
import { useRef, useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import styles from "./ColorPicker.module.css";

// Waits this long after the last drag before saving.
const SAVE_DELAY_MS = 300;

// "#abc" to "#aabbcc", so saved colors always have six digits.
const longHex = (hex: string) =>
  hex.length === 4
    ? `#${[...hex.slice(1)].map((digit) => digit + digit).join("")}`
    : hex;

// A swatch that opens a color picker. Calls `onChange` once dragging pauses.
export function ColorPicker({
  label,
  color,
  onChange,
}: {
  label: string;
  color: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(color);
  const timer = useRef<number | undefined>(undefined);
  const shown = open ? draft : color;

  const pick = (next: string) => {
    const hex = longHex(next.toLowerCase());
    setDraft(hex);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onChange(hex), SAVE_DELAY_MS);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(color);
        setOpen(next);
      }}
    >
      <Popover.Trigger className={styles.trigger} aria-label={label}>
        <span className={styles.swatch} style={{ background: shown }} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8}>
          <Popover.Popup className={styles.popup}>
            <HexColorPicker color={shown} onChange={pick} />
            <HexColorInput
              className={styles.input}
              color={shown}
              onChange={pick}
              prefixed
              aria-label="Hex color"
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
