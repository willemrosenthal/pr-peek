import { MAX_TOKENS, type TokenDto, type TokensResponse } from "@pr-peek/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { cx } from "../cx";
import { queryKeys, useGitHubTokens } from "../queries";
import {
  daysLeft,
  formatDate,
  kindLabel,
  plural,
  reachText,
  reposSyncedBy,
  stateOf,
} from "../tokens";
import { AddToken } from "./AddToken";
import { Alert } from "./Alert";
import { Button } from "./Button";
import styles from "./GitHubTokens.module.css";

// The user's personal access tokens, adding and replacing them, and which token syncs
// each owner they watch.
export function GitHubTokens() {
  const tokens = useGitHubTokens();
  // Null while not adding. A token while replacing it.
  const [adding, setAdding] = useState<{ replacing: TokenDto | null } | null>(
    null,
  );
  const [saved, setSaved] = useState<string | null>(null);

  if (!tokens.data) {
    return tokens.isError ? <Alert>{tokens.error.message}</Alert> : null;
  }
  const { tokens: list, syncedBy } = tokens.data;
  const nameOf = (id: string | null) =>
    list.find((token) => token.id === id)?.name ?? "GitHub sign in";
  const startAdding = (replacing: TokenDto | null = null) => {
    setSaved(null);
    setAdding({ replacing });
  };

  return (
    <div className={cx(styles.tokens, adding && styles.adding)}>
      <section className={styles.section} aria-labelledby="tokens-heading">
        <div className={styles.header}>
          <div className={styles.headerText}>
            <h2 id="tokens-heading" className={styles.heading}>
              GitHub tokens
            </h2>
            <p className={styles.hint}>
              For orgs that block Git Buddy's GitHub app. A fine-grained token
              covers one org, so add one for each.
            </p>
          </div>
          {!adding && list.length < MAX_TOKENS && (
            <Button variant="primary" onClick={() => startAdding()}>
              Add a token
            </Button>
          )}
        </div>
        {saved && (
          <p className={styles.saved} role="status">
            {saved}
          </p>
        )}
        {list.length > 0 && (
          <ul className={styles.list} aria-label="Your tokens">
            {list.map((token) => (
              <TokenCard
                key={token.id}
                token={token}
                syncedBy={syncedBy}
                onReplace={() => startAdding(token)}
              />
            ))}
          </ul>
        )}
        {adding && (
          <AddToken
            replacing={adding.replacing}
            tokens={list}
            syncedBy={syncedBy}
            onSaved={(message) => {
              setAdding(null);
              setSaved(message);
            }}
            onCancel={() => setAdding(null)}
          />
        )}
        <p className={styles.hint}>
          {list.length >= MAX_TOKENS
            ? `You have ${MAX_TOKENS} tokens, the most Git Buddy allows. Remove one to add another.`
            : `Up to ${MAX_TOKENS} tokens. Each one adds a search to every sync.`}{" "}
          Tokens are encrypted, and only ever read your repos.
        </p>
      </section>

      {syncedBy.length > 0 && (
        <section className={styles.section} aria-labelledby="owners-heading">
          <div className={styles.headerText}>
            <h2 id="owners-heading" className={styles.heading}>
              Which token syncs each owner
            </h2>
            <p className={styles.hint}>
              The owners of the repos you watch. Git Buddy picks a working token
              for each, or your GitHub sign in.
            </p>
          </div>
          <ul className={styles.list}>
            {syncedBy.map((row) => (
              <li key={row.owner} className={styles.ownerRow}>
                <span>
                  <strong>{row.owner}</strong>{" "}
                  <span className={styles.muted}>
                    · {plural(row.repos, "repo")}
                  </span>
                </span>
                <span>{nameOf(row.tokenId)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function expiringText(expiresAt: string) {
  const days = daysLeft(expiresAt);
  return days > 0
    ? `Expires in ${plural(days, "day")}. Replace it to keep syncing.`
    : "Expired. Replace it to keep syncing.";
}

function TokenCard({
  token,
  syncedBy,
  onReplace,
}: {
  token: TokenDto;
  syncedBy: TokensResponse["syncedBy"];
  onReplace: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => api(`/github-tokens/${token.id}`, { method: "DELETE" }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.githubTokens }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
      ]),
  });
  const state = stateOf(token);
  // The watched repos it syncs now, which move to another token or the sign in.
  const syncing = reposSyncedBy(syncedBy, token.id);
  const expires = token.expiresAt
    ? `Expires ${formatDate(token.expiresAt)}.`
    : "Never expires.";

  return (
    <li className={styles.card}>
      <div className={styles.cardText}>
        <span className={styles.cardTitle}>
          <strong>{token.name}</strong>
          {token.kind && (
            <span className={styles.badge}>{kindLabel(token.kind)}</span>
          )}
        </span>
        <span className={styles.muted}>
          Covers {reachText(token, syncedBy)}. {expires}
        </span>
        <span className={cx(styles.status, styles[`${state}Text`])}>
          {state === "stopped"
            ? "Stopped working. It may have expired, or been revoked. Its repos sync with another token or your GitHub sign in for now."
            : state === "expiring"
              ? expiringText(token.expiresAt!)
              : "Working."}
        </span>
      </div>
      {remove.isError && <Alert>{remove.error.message}</Alert>}
      {confirming ? (
        <div className={styles.confirm} role="alert">
          <span>
            Remove {token.name}?{" "}
            {syncing > 0
              ? `Its ${plural(syncing, "repo")} sync with another token or your GitHub sign in, which may not reach them.`
              : "No repo you watch uses it."}
          </span>
          <div className={styles.actions}>
            <Button onClick={() => setConfirming(false)}>Keep it</Button>
            <Button
              variant="primary"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          {state !== "working" && (
            <Button variant="primary" onClick={onReplace}>
              Replace
            </Button>
          )}
          <Button onClick={() => setConfirming(true)}>Remove</Button>
        </div>
      )}
    </li>
  );
}
