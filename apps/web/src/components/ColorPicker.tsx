import { Popover } from "@base-ui/react/popover";
import { useRef, useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import styles from "./ColorPicker.module.css";

// Waits this long after the last drag before saving.
export const SAVE_DELAY_MS = 300;

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
  // The pick waiting to be saved.
  const pending = useRef<{ timer: number; hex: string } | null>(null);
  const shown = open ? draft : color;

  // Drops the waiting pick. Returns it, if there was one.
  const takePending = () => {
    const waiting = pending.current;
    if (waiting) window.clearTimeout(waiting.timer);
    pending.current = null;
    return waiting;
  };

  const flush = () => {
    const waiting = takePending();
    if (waiting) onChange(waiting.hex);
  };

  // The draft stays as typed. Changing it mid-typing, like "#e11" to "#ee1111", would
  // rewrite the hex field under the cursor.
  const pick = (next: string) => {
    setDraft(next);
    takePending();
    pending.current = {
      timer: window.setTimeout(flush, SAVE_DELAY_MS),
      hex: longHex(next.toLowerCase()),
    };
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        // Opening starts from the saved color. Closing saves the last pick right away.
        if (next) setDraft(color);
        else flush();
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
