import { RepoPicker } from "../../components/RepoPicker";
import { WatchedRepos } from "../../components/WatchedRepos";
import styles from "./Settings.module.css";
import { SettingsPage } from "./SettingsLayout";

export function ReposPage() {
  return (
    <SettingsPage title="Repositories">
      <p className={styles.hint}>
        Git Buddy only looks at these repos. New ones show up in your list
        within a minute.
      </p>
      <WatchedRepos />
      <RepoPicker />
    </SettingsPage>
  );
}
