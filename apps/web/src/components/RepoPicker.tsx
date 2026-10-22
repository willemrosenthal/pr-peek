import type { AddRepoBody, AddRepoResponse } from "@pr-peek/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { useDebounced } from "../hooks/useDebounced";
import { useRepoSearch, useWatchListChanged } from "../queries";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Card, CardRow } from "./Card";
import { TextField } from "./Field";
import styles from "./Repos.module.css";
import { Spinner } from "./Spinner";

// Waits for typing to pause before searching GitHub.
export const SEARCH_DELAY_MS = 300;

// "owner/name", typed in full.
const FULL_NAME = /^([\w.-]+)\/([\w.-]+)$/;

// Finds repos on GitHub and adds them to the watch list.
export function RepoPicker() {
  const [query, setQuery] = useState("");
  const search = useDebounced(query.trim(), SEARCH_DELAY_MS);
  const results = useRepoSearch(search);

  const options = results.data?.pages.flatMap((page) => page.repos) ?? [];
  const typed = FULL_NAME.exec(search);
  // Offers a typed owner/name that search didn't find, like a repo in an org that
  // blocks pr-peek.
  const typedMissing =
    typed && !options.some((repo) => `${repo.owner}/${repo.name}` === typed[0]);

  return (
    <div className={styles.picker}>
      <TextField
        label="Add a repo"
        type="search"
        placeholder="Search by name, or type owner/name"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {results.isError && <Alert>{results.error.message}</Alert>}
      {results.isPending && <p className={styles.hint}>Loading</p>}
      {(options.length > 0 || typedMissing) && (
        <Card label="Repos you can add">
          {typedMissing && (
            <AddRepoRow
              key={typed[0]}
              repo={{ owner: typed[1]!, name: typed[2]! }}
              watched={false}
            />
          )}
          {options.map((repo) => (
            <AddRepoRow
              key={repo.githubRepoId}
              repo={repo}
              isPrivate={repo.isPrivate}
              watched={repo.watched}
            />
          ))}
        </Card>
      )}
      {results.hasNextPage && (
        <div>
          <Button
            onClick={() => void results.fetchNextPage()}
            disabled={results.isFetchingNextPage}
          >
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}

// One repo, with its own Add button, so several can be added at once.
function AddRepoRow({
  repo,
  isPrivate = false,
  watched,
}: {
  repo: AddRepoBody;
  isPrivate?: boolean;
  watched: boolean;
}) {
  const watchList = useWatchListChanged();
  const add = useMutation({
    mutationFn: () =>
      api<AddRepoResponse>("/repos", {
        method: "POST",
        body: { owner: repo.owner, name: repo.name },
      }),
    onSuccess: ({ repo: added }) =>
      watchList.setWatched(added.githubRepoId, true),
  });
  const name = `${repo.owner}/${repo.name}`;

  return (
    <CardRow>
      <span className={styles.name}>
        {name}
        {isPrivate && <span className={styles.hint}>Private</span>}
      </span>
      {watched || add.isSuccess ? (
        <span className={styles.hint}>Watching</span>
      ) : add.isPending ? (
        <span className={styles.adding} role="status">
          <Spinner />
          Adding
        </span>
      ) : (
        <Button aria-label={`Add ${name}`} onClick={() => add.mutate()}>
          Add
        </Button>
      )}
      {add.isError && <Alert>{add.error.message}</Alert>}
    </CardRow>
  );
}
