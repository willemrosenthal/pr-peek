import { BackToList } from "../components/BackToList";
import { InstallHere, OtherDevices } from "../components/InstallSteps";
import { useReturnToList } from "../hooks/useReturnToList";
import styles from "./InstallPage.module.css";

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
      </div>
    </main>
  );
}
