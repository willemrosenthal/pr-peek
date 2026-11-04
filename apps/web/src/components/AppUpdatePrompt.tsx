import { useEffect, useState } from "react";
import { restartToUpdate, updateReady } from "../desktop";
import { Button } from "./Button";
import styles from "./UpdatePrompt.module.css";

// Offers a restart once a new version of the Mac app has installed. The app fires
// `pr-peek:update-ready` when that happens, and is asked on load in case it already did.
export function AppUpdatePrompt() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void updateReady().then((answer) => {
      if (active && answer) setReady(true);
    });
    const onReady = () => setReady(true);
    window.addEventListener("pr-peek:update-ready", onReady);
    return () => {
      active = false;
      window.removeEventListener("pr-peek:update-ready", onReady);
    };
  }, []);

  if (!ready) return null;
  return (
    <div className={styles.prompt} role="status">
      Update ready.
      <Button variant="primary" onClick={restartToUpdate}>
        Restart
      </Button>
    </div>
  );
}
