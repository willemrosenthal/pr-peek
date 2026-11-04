import { BackToList } from "../components/BackToList";
import { ButtonLink } from "../components/Button";
import { InstallHere, OtherDevices } from "../components/InstallSteps";
import { inDesktopApp } from "../desktop";
import { useReturnToList } from "../hooks/useReturnToList";
import styles from "./InstallPage.module.css";

// Built by .github/workflows/desktop-release.yml.
const MAC_APP_DOWNLOAD =
  "https://github.com/willemrosenthal/pr-peek/releases/latest";

// How to install the app. Open to everyone, so it can be shared before signing in.
export function InstallPage() {
  useReturnToList();
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <BackToList />
          <h1 className={styles.title}>Install Git Buddy</h1>
          <p className={styles.hint}>
            It opens in its own window, like any other app.
          </p>
        </header>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>On this device</h2>
          <InstallHere />
        </section>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>On other devices</h2>
          <OtherDevices />
        </section>
        {!inDesktopApp() && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Mac menu bar app</h2>
            <p className={styles.hint}>
              Your list in the Mac menu bar, with a count next to the icon and
              native alerts.
            </p>
            <div>
              <ButtonLink
                href={MAC_APP_DOWNLOAD}
                target="_blank"
                rel="noopener"
              >
                Download for Mac
              </ButtonLink>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
