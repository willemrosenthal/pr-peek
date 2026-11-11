import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../../api";
import { setBadge } from "../../badge";
import { Alert } from "../../components/Alert";
import { Avatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { CardRow } from "../../components/Card";
import { GitHubTokens } from "../../components/GitHubTokens";
import { Group } from "../../components/Group";
import { cx } from "../../cx";
import { clearTrayState } from "../../desktop";
import { useMe } from "../../queries";
import styles from "./AccountPage.module.css";
import { SettingsPage } from "./SettingsLayout";

// Who's signed in, their GitHub tokens, signing out, and deleting the account.
export function AccountPage() {
  const user = useMe().data?.user;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // After signing out or deleting the account: nothing of theirs stays on this device.
  const leave = async () => {
    queryClient.clear();
    void setBadge(0);
    clearTrayState();
    await navigate("/signin", { replace: true });
  };
  const signOut = useMutation({
    mutationFn: () => api("/auth/signout", { method: "POST" }),
    onSuccess: leave,
  });

  return (
    <SettingsPage title="Account">
      <div className={styles.profile}>
        <Avatar user={user} className={styles.avatar} />
        <p className={styles.login}>{user?.login}</p>
        <p className={styles.hint}>Signed in with GitHub</p>
      </div>
      <GitHubTokens />
      <Group label="Sign out">
        <CardRow className={styles.actionRow}>
          <button
            type="button"
            className={styles.action}
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
          >
            Sign out
          </button>
        </CardRow>
      </Group>
      <DeleteAccount onDeleted={leave} />
    </SettingsPage>
  );
}

// Deletes everything Git Buddy keeps about the user, after asking.
function DeleteAccount({ onDeleted }: { onDeleted: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const remove = useMutation({
    mutationFn: () => api("/me", { method: "DELETE" }),
    onSuccess: onDeleted,
  });
  if (!asking) {
    return (
      <Group
        label="Delete account"
        footer="Deletes everything Git Buddy keeps about you, after you confirm."
      >
        <CardRow className={styles.actionRow}>
          <button
            type="button"
            className={cx(styles.action, styles.danger)}
            onClick={() => setAsking(true)}
          >
            Delete my account
          </button>
        </CardRow>
      </Group>
    );
  }
  return (
    <div className={styles.confirm} role="alert">
      <p>
        Delete your account? Git Buddy deletes everything it keeps about you,
        signs you out everywhere, and gives up its access to your GitHub
        account. Personal access tokens you made stay on GitHub. Delete them
        there if you like.
      </p>
      {remove.isError && <Alert>{remove.error.message}</Alert>}
      <div className={styles.confirmActions}>
        <Button onClick={() => setAsking(false)}>Keep my account</Button>
        <Button
          variant="primary"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
        >
          {remove.isPending ? "Deleting" : "Delete my account"}
        </Button>
      </div>
    </div>
  );
}
