import {
  Bell,
  ChartNoAxesColumn,
  Clock,
  FolderGit2,
  KeyRound,
  LayoutList,
  ListChecks,
  Monitor,
} from "lucide-react";
import { AppVersion } from "../../components/AppVersion";
import { Avatar } from "../../components/Avatar";
import { Group } from "../../components/Group";
import { LinkRow } from "../../components/LinkRow";
import { ISSUES_URL } from "../../build";
import { inDesktopApp } from "../../desktop";
import {
  useGitHubTokens,
  useMe,
  useRepos,
  useSettings,
  useSignUpRequests,
} from "../../queries";
import {
  notificationsStatus,
  overdueStatus,
  reposStatus,
  rulesStatus,
  tokensStatus,
} from "../../settingsStatus";
import { SettingsPage } from "./SettingsLayout";
import styles from "./HomePage.module.css";

// The settings home screen: a row for each page, with a line on how it's set.
export function HomePage() {
  const me = useMe().data;
  const settings = useSettings().data;
  const repos = useRepos().data?.repos;
  const tokens = useGitHubTokens().data?.tokens;
  const isAdmin = me?.isAdmin ?? false;
  const requests = useSignUpRequests(isAdmin).data?.requests;
  const tokenStatus = tokens && tokensStatus(tokens);

  return (
    <SettingsPage title="Settings" back="/">
      <Group label="Account">
        <LinkRow
          to="/settings/account"
          label={
            <span className={styles.account}>
              <Avatar user={me?.user} className={styles.avatar} />
              <span className={styles.who}>
                <span className={styles.login}>{me?.user.login}</span>{" "}
                <span className={styles.signedIn}>Signed in with GitHub</span>
              </span>
            </span>
          }
        />
      </Group>

      <Group title="Your list">
        <LinkRow
          to="/settings/repos"
          icon={FolderGit2}
          color="var(--color-kind-review)"
          label="Repositories"
          status={repos && reposStatus(repos)}
        />
        <LinkRow
          to="/settings/rules"
          icon={ListChecks}
          color="var(--color-kind-talk)"
          label="Rules"
          status={settings && rulesStatus(settings.rules)}
        />
        <LinkRow
          to="/settings/overdue"
          icon={Clock}
          color="var(--color-tile-overdue)"
          label="Overdue reviews"
          status={settings && overdueStatus(settings.settings)}
        />
        <LinkRow
          to="/settings/display"
          icon={LayoutList}
          color="var(--color-kind-assigned)"
          label="List display"
          status="Authors, section order, size"
        />
      </Group>

      <Group title="Alerts">
        <LinkRow
          to="/settings/notifications"
          icon={Bell}
          color="var(--color-kind-failed)"
          label="Notifications"
          status={settings && notificationsStatus(settings.settings)}
        />
      </Group>

      <Group title="GitHub">
        <LinkRow
          to="/settings/account"
          icon={KeyRound}
          color="var(--color-tile-gray)"
          label="GitHub tokens"
          status={tokenStatus?.text}
          tone={tokenStatus?.tone}
        />
        {isAdmin && (
          <LinkRow
            to="/settings/admin"
            icon={ChartNoAxesColumn}
            color="var(--color-tile-dark)"
            label="Admin"
            status={
              requests && requests.length > 0
                ? `${requests.length} waiting to sign up`
                : "Costs and sign-ups"
            }
          />
        )}
      </Group>

      {inDesktopApp() && (
        <Group title="This Mac">
          <LinkRow
            to="/settings/menu-bar"
            icon={Monitor}
            color="var(--color-kind-merged)"
            label="Menu bar"
            status="Launch at login, count, icon"
          />
        </Group>
      )}

      <Group title="Help">
        {/* The Mac app opens it in the browser, where its email link works. */}
        <LinkRow
          to="/privacy"
          newTab={inDesktopApp()}
          label="How Git Buddy uses your data"
        />
        <LinkRow href={ISSUES_URL} label="Report a bug or ask for something" />
      </Group>

      <div className={styles.version}>
        <AppVersion />
      </div>
    </SettingsPage>
  );
}
