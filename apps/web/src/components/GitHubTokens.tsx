import { MAX_TOKENS, plural, type TokenDto } from "@pr-peek/core";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useItemSheet } from "../hooks/useItemSheet";
import { useGitHubTokens } from "../queries";
import { stateOf, tokenProblem, tokenSummary, tokenTone } from "../tokens";
import { AddTokenSheet, type Adding } from "./AddToken";
import { Alert } from "./Alert";
import { CardRow } from "./Card";
import styles from "./GitHubTokens.module.css";
import { Group } from "./Group";
import { LinkRow } from "./LinkRow";
import { TokenSheet } from "./TokenSheet";

// The user's personal access tokens, adding and replacing them, and which token syncs
// each owner they watch.
export function GitHubTokens() {
  const tokens = useGitHubTokens();
  const list = tokens.data?.tokens ?? [];
  const sheet = useItemSheet(list);
  // Null while the add a token sheet is closed.
  const [adding, setAdding] = useState<Adding | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  if (!tokens.data) {
    return tokens.isError ? <Alert>{tokens.error.message}</Alert> : null;
  }
  const { syncedBy } = tokens.data;
  const nameOf = (id: string | null) =>
    list.find((token) => token.id === id)?.name ?? "GitHub sign in";
  const full = list.length >= MAX_TOKENS;
  const startAdding = (replacing: TokenDto | null = null) => {
    setSaved(null);
    setAdding({ replacing });
  };

  return (
    <>
      {saved && (
        <p className={styles.saved} role="status">
          {saved}
        </p>
      )}
      <Group
        title="GitHub tokens"
        aside={
          list.length > 0 ? `${list.length} (max ${MAX_TOKENS})` : undefined
        }
        label={list.length > 0 ? "Your tokens" : "GitHub tokens"}
        footer={
          <>
            For private repos. Signing in only reads public ones. A fine-grained
            token covers one account or org, so add one for each.{" "}
            {full
              ? `You have ${MAX_TOKENS} tokens, the most Git Buddy allows. Remove one to add another.`
              : "Each one adds a search to every sync."}{" "}
            Tokens are encrypted, and Git Buddy only reads with them.
          </>
        }
      >
        {list.map((token) => (
          <LinkRow
            key={token.id}
            onClick={() => sheet.show(token)}
            label={token.name}
            status={tokenSummary(token, syncedBy)}
            note={tokenProblem(token)}
            tone={tokenTone(token)}
            after={
              stateOf(token) !== "working" && (
                <button
                  type="button"
                  className={styles.replace}
                  aria-label={`Replace ${token.name}`}
                  onClick={() => startAdding(token)}
                >
                  Replace
                </button>
              )
            }
          />
        ))}
        {!full && (
          // Its own row, not a CardRow, so the button fills it.
          <li className={styles.addRow}>
            <button
              type="button"
              className={styles.add}
              onClick={() => startAdding()}
            >
              <Plus size={20} strokeWidth={2.5} aria-hidden="true" />
              Add a token
            </button>
          </li>
        )}
      </Group>

      <TokenSheet
        token={sheet.item}
        open={sheet.open}
        onClose={sheet.close}
        syncedBy={syncedBy}
        onReplace={(token) => {
          sheet.close();
          startAdding(token);
        }}
      />
      <AddTokenSheet
        adding={adding}
        tokens={list}
        syncedBy={syncedBy}
        onSaved={(message) => {
          setAdding(null);
          setSaved(message);
        }}
        onClose={() => setAdding(null)}
      />

      {syncedBy.length > 0 && (
        <Group
          title="Which token syncs each owner"
          footer="The owners of the repos you watch. Git Buddy picks a working token for each, or your GitHub sign in."
        >
          {syncedBy.map((row) => (
            <CardRow key={row.owner} className={styles.ownerRow}>
              <span className={styles.owner}>
                <strong>{row.owner}</strong>{" "}
                <span className={styles.muted}>
                  · {plural(row.repos, "repo")}
                </span>
              </span>
              <span className={styles.muted}>{nameOf(row.tokenId)}</span>
            </CardRow>
          ))}
        </Group>
      )}
    </>
  );
}
