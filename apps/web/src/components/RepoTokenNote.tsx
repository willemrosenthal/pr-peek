import { useState } from "react";
import { useGitHubTokens } from "../queries";
import { AddTokenSheet, type Adding } from "./AddToken";
import { Button } from "./Button";
import styles from "./Repos.module.css";

// Above the repo picker, in onboarding and Settings. With no tokens, a note that org
// repos usually need one. With some, a smaller link to add another.
export function RepoTokenNote() {
  const tokens = useGitHubTokens();
  // Set as a new object each time, so the sheet starts a fresh form.
  const [adding, setAdding] = useState<Adding | null>(null);
  const [saved, setSaved] = useState(false);
  const list = tokens.data?.tokens ?? [];
  const add = () => setAdding({ replacing: null });

  return (
    <>
      {saved ? (
        // Stays after a save, for a second org.
        <p className={styles.hint}>
          <span className={styles.saved} role="status">
            Token saved. Its repos show below.
          </span>{" "}
          <Button variant="link" onClick={add}>
            Add another
          </Button>
        </p>
      ) : list.length === 0 ? (
        // Waits for the list, so a user with tokens doesn't see it flash.
        tokens.isSuccess && (
          <div className={styles.tokenNote}>
            <p>
              <strong>Repos from an org?</strong> Most orgs need a GitHub token
              before Git Buddy can see their repos.
            </p>
            <Button onClick={add}>Add a token</Button>
          </div>
        )
      ) : (
        <p className={styles.hint}>
          Missing an org's repos?{" "}
          <Button variant="link" onClick={add}>
            Add a token
          </Button>
        </p>
      )}
      <AddTokenSheet
        adding={adding}
        tokens={list}
        syncedBy={tokens.data?.syncedBy ?? []}
        onSaved={() => {
          setAdding(null);
          setSaved(true);
        }}
        onClose={() => setAdding(null)}
      />
    </>
  );
}
