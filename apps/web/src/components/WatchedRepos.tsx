import type { UpdateRepoBody, WatchedRepoDto } from "@pr-peek/core";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api";
import { useReloadWatchList, useRepos } from "../queries";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Card, CardRow } from "./Card";
import { Control, Controls } from "./Control";
import styles from "./Repos.module.css";
import { Switch } from "./Switch";

// The repos pr-peek watches. Each can be muted (on the list, no notifications), paused
// (not checked at all), or removed.
export function WatchedRepos() {
  const repos = useRepos();

  if (repos.isPending) return <p className={styles.hint}>Loading</p>;
  if (repos.isError) return <Alert>{repos.error.message}</Alert>;
  if (repos.data.repos.length === 0) {
    return <p className={styles.hint}>You're not watching any repos yet.</p>;
  }
  return (
    <Card label="Watched repos">
      {repos.data.repos.map((repo) => (
        <WatchedRepo key={repo.id} repo={repo} />
      ))}
    </Card>
  );
}

function WatchedRepo({ repo }: { repo: WatchedRepoDto }) {
  const reloadWatchList = useReloadWatchList();
  const update = useMutation({
    mutationFn: (changes: UpdateRepoBody) =>
      api(`/repos/${repo.id}`, { method: "PATCH", body: changes }),
    onSettled: reloadWatchList,
  });
  const remove = useMutation({
    mutationFn: () => api(`/repos/${repo.id}`, { method: "DELETE" }),
    onSuccess: reloadWatchList,
  });
  const name = `${repo.owner}/${repo.name}`;
  // Shows the new state while it saves.
  const saving = update.isPending ? update.variables : {};
  const enabled = saving.enabled ?? repo.enabled;
  const muted = saving.muted ?? repo.muted;
  const error = update.error ?? remove.error;

  return (
    <CardRow>
      <span className={styles.name}>
        {name}
        {!enabled && <span className={styles.hint}>Paused</span>}
        {enabled && muted && <span className={styles.hint}>Muted</span>}
      </span>
      <Controls>
        <Control name="Notify">
          <Switch
            label={`Notify for ${name}`}
            checked={!muted}
            onChange={(on) => update.mutate({ muted: !on })}
            disabled={update.isPending || !enabled}
          />
        </Control>
        <Control name="Watch">
          <Switch
            label={`Watch ${name}`}
            checked={enabled}
            onChange={(on) => update.mutate({ enabled: on })}
            disabled={update.isPending}
          />
        </Control>
      </Controls>
      <Button
        aria-label={`Remove ${name}`}
        onClick={() => remove.mutate()}
        disabled={remove.isPending}
      >
        Remove
      </Button>
      {error && <Alert>{error.message}</Alert>}
    </CardRow>
  );
}
