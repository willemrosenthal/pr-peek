import { RepoPicker } from "../../components/RepoPicker";
import { RepoTokenNote } from "../../components/RepoTokenNote";
import styles from "./Settings.module.css";
import { SettingsPage } from "./SettingsLayout";

// Pick repos to watch. New ones show up in the list within a minute.
export function AddReposPage() {
  return (
    <SettingsPage title="Add repos" back="/settings/repos">
      <p className={styles.hint}>
        New repos show up in your list within a minute.
      </p>
      <RepoTokenNote />
      <RepoPicker />
    </SettingsPage>
  );
}
