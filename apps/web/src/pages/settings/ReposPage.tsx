import { Plus } from "lucide-react";
import { Link } from "react-router";
import { Group } from "../../components/Group";
import { LinkRow } from "../../components/LinkRow";
import { WatchedRepos } from "../../components/WatchedRepos";
import styles from "./Settings.module.css";
import { SettingsPage } from "./SettingsLayout";

const ADD_PAGE = "/settings/repos/add";

export function ReposPage() {
  return (
    <SettingsPage
      title="Repositories"
      action={
        <Link to={ADD_PAGE} className={styles.headerAction}>
          <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
          Add
        </Link>
      }
    >
      <p className={styles.hint}>
        Git Buddy only looks at these repos. Tap one to mute, pause, or color
        it.
      </p>
      <WatchedRepos />
      <Group label="Add repos">
        <LinkRow
          to={ADD_PAGE}
          icon={Plus}
          color="var(--color-accent)"
          label="Add repos"
        />
      </Group>
    </SettingsPage>
  );
}
