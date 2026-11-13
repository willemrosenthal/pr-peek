import type { DeleteAccountResponse } from "@pr-peek/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ActionRow } from "../../components/ActionRow";
import { Alert } from "../../components/Alert";
import { Avatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { GitHubTokens } from "../../components/GitHubTokens";
import { Group } from "../../components/Group";
import { useLeave } from "../../hooks/useLeave";
import { useMe } from "../../queries";
import { requestAccountDeletion, requestSignOut } from "../../signOut";
import styles from "./AccountPage.module.css";
import { SettingsPage } from "./SettingsLayout";

// Who's signed in, their GitHub tokens, signing out, and deleting the account.
export function AccountPage() {
  const user = useMe().data?.user;
  const leave = useLeave();
  const signOut = useMutation({
    mutationFn: requestSignOut,
    onSuccess: () => leave(),
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
        <ActionRow
          label="Sign out"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
        />
        {signOut.isError && <Alert>{signOut.error.message}</Alert>}
      </Group>
      <DeleteAccount
        onDeleted={({ githubRevoked }) =>
          leave({ githubAccessKept: !githubRevoked })
        }
      />
    </SettingsPage>
  );
}

// Deletes everything Git Buddy keeps about the user, after asking.
function DeleteAccount({
  onDeleted,
}: {
  onDeleted: (result: DeleteAccountResponse) => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const remove = useMutation({
    mutationFn: requestAccountDeletion,
    onSuccess: onDeleted,
  });
  if (!asking) {
    return (
      <Group
        label="Delete account"
        footer="Deletes everything Git Buddy keeps about you, after you confirm."
      >
        <ActionRow
          label="Delete my account"
          onClick={() => setAsking(true)}
          danger
        />
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
