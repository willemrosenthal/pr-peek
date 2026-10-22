import type { WatchedRepoDto } from "@pr-peek/core";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api";
import { useRepos, useWatchListChanged } from "../queries";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Card, CardRow } from "./Card";
import styles from "./Repos.module.css";
import { Switch } from "./Switch";

// The repos pr-peek watches, with a switch to pause each and a button to remove it.
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
  const watchList = useWatchListChanged();
  const update = useMutation({
    mutationFn: (enabled: boolean) =>
      api(`/repos/${repo.id}`, { method: "PATCH", body: { enabled } }),
    onSettled: watchList.reload,
  });
  const remove = useMutation({
    mutationFn: () => api(`/repos/${repo.id}`, { method: "DELETE" }),
    onSuccess: () => watchList.setWatched(repo.githubRepoId, false),
  });
  const name = `${repo.owner}/${repo.name}`;
  // Shows the new state while it saves.
  const enabled = update.isPending ? update.variables : repo.enabled;
  const error = update.error ?? remove.error;

  return (
    <CardRow>
      <span className={styles.name}>
        {name}
        {!enabled && <span className={styles.hint}>Paused</span>}
      </span>
      <Switch
        label={`Watch ${name}`}
        checked={enabled}
        onChange={(on) => update.mutate(on)}
        disabled={update.isPending}
      />
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
