import {
  daysLeft,
  MAX_TOKENS,
  plural,
  type TokenDto,
  type TokensResponse,
} from "@pr-peek/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { cx } from "../cx";
import { refreshTokens, useGitHubTokens } from "../queries";
import {
  formatDate,
  kindLabel,
  reachText,
  reposSyncedBy,
  stateOf,
} from "../tokens";
import { AddTokenSheet, type Adding } from "./AddToken";
import { Alert } from "./Alert";
import { ActionRow } from "./ActionRow";
import { Button } from "./Button";
import { CardRow } from "./Card";
import { Group } from "./Group";
import styles from "./GitHubTokens.module.css";

// The user's personal access tokens, adding and replacing them, and which token syncs
// each owner they watch.
export function GitHubTokens() {
  const tokens = useGitHubTokens();
  // Null while the sheet is closed.
  const [adding, setAdding] = useState<Adding | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  if (!tokens.data) {
    return tokens.isError ? <Alert>{tokens.error.message}</Alert> : null;
  }
  const { tokens: list, syncedBy } = tokens.data;
  const nameOf = (id: string | null) =>
    list.find((token) => token.id === id)?.name ?? "GitHub sign in";
  const full = list.length >= MAX_TOKENS;
  // Under the Add button, or under the tokens once there's no room for more.
  const about = (
    <>
      For orgs that block Git Buddy's GitHub app. A fine-grained token covers
      one org, so add one for each.{" "}
      {full
        ? `You have ${MAX_TOKENS} tokens, the most Git Buddy allows. Remove one to add another.`
        : "Each one adds a search to every sync."}{" "}
      Tokens are encrypted, and only ever read your repos.
    </>
  );
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
      {list.length > 0 && (
        <Group
          title="GitHub tokens"
          aside={`${list.length} of ${MAX_TOKENS}`}
          label="Your tokens"
          footer={full ? about : undefined}
        >
          {list.map((token) => (
            <TokenRow
              key={token.id}
              token={token}
              syncedBy={syncedBy}
              onReplace={() => startAdding(token)}
            />
          ))}
        </Group>
      )}
      {!full && (
        <Group
          title={list.length === 0 ? "GitHub tokens" : undefined}
          label="Add a token"
          footer={about}
        >
          <ActionRow label="Add a token" onClick={() => startAdding()} />
        </Group>
      )}

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

function expiringText(expiresAt: string) {
  const days = daysLeft(expiresAt);
  return days > 0
    ? `Expires in ${plural(days, "day")}. Replace it to keep syncing.`
    : "Expired. Replace it to keep syncing.";
}

function TokenRow({
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
    onSuccess: () => refreshTokens(queryClient),
  });
  const state = stateOf(token);
  // The watched repos it syncs now, which move to another token or the sign in.
  const syncing = reposSyncedBy(syncedBy, token.id);
  const expires = token.expiresAt
    ? `Expires ${formatDate(token.expiresAt)}.`
    : "Never expires.";

  return (
    <CardRow className={styles.tokenRow}>
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
    </CardRow>
  );
}
