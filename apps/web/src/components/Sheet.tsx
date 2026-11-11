import { Drawer } from "@base-ui/react/drawer";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./Sheet.module.css";

// A sheet that slides up from the bottom, with a handle to swipe it down, its title,
// and a close button. Tapping outside or swiping down calls `onClose`.
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Drawer.Portal>
        <Drawer.Backdrop className={styles.backdrop} />
        <Drawer.Viewport className={styles.viewport}>
          <Drawer.Popup className={styles.sheet}>
            <div className={styles.body}>
              <div className={styles.handle} aria-hidden="true" />
              <div className={styles.top}>
                <Drawer.Title className={styles.title}>{title}</Drawer.Title>
                <Drawer.Close className={styles.close} aria-label="Close">
                  <X aria-hidden="true" />
                </Drawer.Close>
              </div>
              {children}
            </div>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
