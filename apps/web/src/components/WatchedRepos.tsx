import type { UpdateRepoBody, WatchedRepoDto } from "@pr-peek/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys, useReloadWatchList, useRepos } from "../queries";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Card, CardRow } from "./Card";
import { ColorPicker } from "./ColorPicker";
import { Control, Controls } from "./Control";
import { RepoTag } from "./RepoTag";
import styles from "./Repos.module.css";
import { Switch } from "./Switch";

// A repo's first color when turned on, picked by its place in the list.
const DEFAULT_COLORS = [
  "#2563eb",
  "#16a34a",
  "#db2777",
  "#ea580c",
  "#7c3aed",
  "#0891b2",
  "#ca8a04",
  "#e11d48",
];

// The repos pr-peek watches. Each can be muted (on the list, no notifications), paused
// (not checked at all), colored, or removed.
export function WatchedRepos() {
  const repos = useRepos();

  if (repos.isPending) return <p className={styles.hint}>Loading</p>;
  if (repos.isError) return <Alert>{repos.error.message}</Alert>;
  if (repos.data.repos.length === 0) {
    return <p className={styles.hint}>You're not watching any repos yet.</p>;
  }
  return (
    <Card label="Watched repos">
      {repos.data.repos.map((repo, index) => (
        <WatchedRepo
          key={repo.id}
          repo={repo}
          defaultColor={DEFAULT_COLORS[index % DEFAULT_COLORS.length]!}
        />
      ))}
    </Card>
  );
}

function WatchedRepo({
  repo,
  defaultColor,
}: {
  repo: WatchedRepoDto;
  defaultColor: string;
}) {
  const queryClient = useQueryClient();
  const reloadWatchList = useReloadWatchList();
  const update = useMutation({
    mutationFn: (changes: UpdateRepoBody) =>
      api(`/repos/${repo.id}`, { method: "PATCH", body: changes }),
    onSettled: () =>
      Promise.all([
        reloadWatchList(),
        queryClient.invalidateQueries({ queryKey: queryKeys.items }),
      ]),
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
  // Null turns color off, so only a missing field falls back.
  const color = saving.color !== undefined ? saving.color : repo.color;
  const error = update.error ?? remove.error;

  return (
    <CardRow>
      <span className={styles.name}>
        <RepoTag color={color}>{name}</RepoTag>
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
        <Control name="Color">
          <Switch
            label={`Color for ${name}`}
            checked={color !== null}
            onChange={(on) =>
              update.mutate({ color: on ? defaultColor : null })
            }
            disabled={update.isPending}
          />
        </Control>
        {color && (
          <ColorPicker
            label={`Pick a color for ${name}`}
            color={color}
            onChange={(picked) => update.mutate({ color: picked })}
          />
        )}
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
