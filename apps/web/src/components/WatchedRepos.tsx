import type { WatchedRepoDto } from "@pr-peek/core";
import { useItemSheet } from "../hooks/useItemSheet";
import { useRepos } from "../queries";
import { byOwner, watchOf, WATCH_LABELS } from "../repoWatch";
import { Alert } from "./Alert";
import { Group } from "./Group";
import { LinkRow } from "./LinkRow";
import { RepoSheet } from "./RepoSheet";
import styles from "./Repos.module.css";

// The repos Git Buddy watches, grouped by owner. Tapping one opens its sheet.
export function WatchedRepos() {
  const repos = useRepos();
  const list = repos.data?.repos ?? [];
  const sheet = useItemSheet(list);

  if (repos.isPending) return <p className={styles.hint}>Loading</p>;
  if (repos.isError) return <Alert>{repos.error.message}</Alert>;

  return (
    <>
      {list.length === 0 ? (
        <p className={styles.hint}>You're not watching any repos yet.</p>
      ) : (
        byOwner(list).map(([owner, owned]) => (
          <Group
            key={owner}
            title={owner}
            aside={String(owned.length)}
            label={`Watched repos from ${owner}`}
          >
            {owned.map((repo) => (
              <WatchedRepo
                key={repo.id}
                repo={repo}
                onOpen={() => sheet.show(repo)}
              />
            ))}
          </Group>
        ))
      )}
      <RepoSheet repo={sheet.item} open={sheet.open} onClose={sheet.close} />
    </>
  );
}

function WatchedRepo({
  repo,
  onOpen,
}: {
  repo: WatchedRepoDto;
  onOpen: () => void;
}) {
  const watch = watchOf(repo);
  return (
    <LinkRow
      onClick={onOpen}
      start={
        <span
          className={repo.colorOn ? styles.dot : styles.noDot}
          style={repo.colorOn && repo.color ? { background: repo.color } : {}}
          aria-hidden="true"
        />
      }
      label={
        <span className={watch === "paused" ? styles.paused : undefined}>
          {repo.name}
        </span>
      }
      status={watch === "notify" ? undefined : WATCH_LABELS[watch]}
    />
  );
}
