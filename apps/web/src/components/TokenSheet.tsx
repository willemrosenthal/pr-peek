import { plural, type TokenDto, type TokensResponse } from "@pr-peek/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { cx } from "../cx";
import { refreshTokens } from "../queries";
import {
  formatDate,
  kindLabel,
  reachText,
  reposSyncedBy,
  stateOf,
  tokenProblem,
} from "../tokens";
import { ActionRow } from "./ActionRow";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { CardRow } from "./Card";
import styles from "./GitHubTokens.module.css";
import { Group } from "./Group";
import { Sheet } from "./Sheet";

// The sheet for one token: what it covers, when it expires, Replace, and Remove. It
// stays on the page while closed, so it slides in every time. Its contents start fresh
// for each token.
export function TokenSheet({
  token,
  open,
  onClose,
  syncedBy,
  onReplace,
}: {
  // The last token opened. It stays while the sheet slides away, even once removed.
  token: TokenDto | null;
  open: boolean;
  onClose: () => void;
  syncedBy: TokensResponse["syncedBy"];
  onReplace: (token: TokenDto) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={token?.name}>
      {token && (
        <TokenDetails
          key={token.id}
          token={token}
          syncedBy={syncedBy}
          onReplace={() => onReplace(token)}
          onRemoved={onClose}
        />
      )}
    </Sheet>
  );
}

function TokenDetails({
  token,
  syncedBy,
  onReplace,
  onRemoved,
}: {
  token: TokenDto;
  syncedBy: TokensResponse["syncedBy"];
  onReplace: () => void;
  onRemoved: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => api(`/github-tokens/${token.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      onRemoved();
      await refreshTokens(queryClient);
    },
  });
  const state = stateOf(token);
  const problem = tokenProblem(token);
  // The watched repos it syncs now, which move to another token or the sign in.
  const syncing = reposSyncedBy(syncedBy, token.id);

  return (
    <>
      <Group
        label="About this token"
        footer={
          state === "stopped"
            ? "It may have expired, or been revoked. Its repos sync with another token or your GitHub sign in for now."
            : state === "expiring"
              ? "Replace it to keep syncing."
              : undefined
        }
      >
        {token.kind && <Detail name="Kind" value={kindLabel(token.kind)} />}
        <Detail name="Covers" value={reachText(token, syncedBy)} />
        <Detail
          name="Expires"
          value={token.expiresAt ? formatDate(token.expiresAt) : "Never"}
        />
        <Detail
          name="Status"
          value={problem ?? "Working"}
          className={styles[`${state}Text`]}
        />
      </Group>
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
        <Group label="Token actions">
          <ActionRow label="Replace" onClick={onReplace} />
          <ActionRow
            label="Remove"
            onClick={() => setConfirming(true)}
            danger
          />
        </Group>
      )}
    </>
  );
}

// One fact about the token: its name on the left, its value on the right.
function Detail({
  name,
  value,
  className,
}: {
  name: string;
  value: string;
  className?: string | undefined;
}) {
  return (
    <CardRow className={styles.detail}>
      <span className={styles.detailName}>{name}</span>
      <span className={cx(styles.detailValue, className)}>{value}</span>
    </CardRow>
  );
}
