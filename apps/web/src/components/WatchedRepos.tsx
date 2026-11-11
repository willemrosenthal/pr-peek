import type { WatchedRepoDto } from "@pr-peek/core";
import { useState } from "react";
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
  // The repo whose sheet is open, and the last one opened, which stays in the sheet
  // while it slides away, even once removed.
  const [openId, setOpenId] = useState<string | null>(null);
  const [last, setLast] = useState<WatchedRepoDto | null>(null);

  if (repos.isPending) return <p className={styles.hint}>Loading</p>;
  if (repos.isError) return <Alert>{repos.error.message}</Alert>;
  const list = repos.data.repos;
  const current = list.find((repo) => repo.id === last?.id) ?? last;

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
                onOpen={() => {
                  setLast(repo);
                  setOpenId(repo.id);
                }}
              />
            ))}
          </Group>
        ))
      )}
      {current && (
        <RepoSheet
          repo={current}
          open={openId !== null && list.some((repo) => repo.id === openId)}
          onClose={() => setOpenId(null)}
        />
      )}
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
