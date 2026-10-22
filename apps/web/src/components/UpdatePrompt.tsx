import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "./Button";
import styles from "./UpdatePrompt.module.css";

const CHECK_EVERY_MS = 60 * 60 * 1000;

// Offers a reload when a new version of the app has downloaded.
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // The app stays open for days, so look for new versions every hour.
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => {
        // Fails while offline. The next check tries again.
        registration.update().catch(() => {});
      }, CHECK_EVERY_MS);
    },
  });

  if (!needRefresh) return null;
  return (
    <div className={styles.prompt} role="status">
      New version available.
      <Button variant="primary" onClick={() => void updateServiceWorker(true)}>
        Reload
      </Button>
    </div>
  );
}
