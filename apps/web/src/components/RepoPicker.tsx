import type { AddRepoBody, RepoOption } from "@pr-peek/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { useDebounced } from "../hooks/useDebounced";
import { useInvalidateRepos, useRepoSearch } from "../queries";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Card, CardRow } from "./Card";
import styles from "./Repos.module.css";
import { TextField } from "./Field";

// Waits for typing to pause before searching GitHub.
export const SEARCH_DELAY_MS = 300;

// "owner/name", typed in full.
const FULL_NAME = /^([\w.-]+)\/([\w.-]+)$/;

// Finds repos on GitHub and adds them to the watch list.
export function RepoPicker() {
  const [query, setQuery] = useState("");
  const search = useDebounced(query.trim(), SEARCH_DELAY_MS);
  const results = useRepoSearch(search);
  const invalidateRepos = useInvalidateRepos();
  const add = useMutation({
    mutationFn: (repo: AddRepoBody) =>
      api("/repos", { method: "POST", body: repo }),
    onSuccess: invalidateRepos,
  });

  const options = results.data?.pages.flatMap((page) => page.repos) ?? [];
  const typed = FULL_NAME.exec(search);
  // A full name search doesn't list, like a repo in an org that blocks pr-peek.
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
      {add.isError && <Alert>{add.error.message}</Alert>}
      {results.isError && <Alert>{results.error.message}</Alert>}
      {(options.length > 0 || typedMissing) && (
        <Card label="Repos you can add">
          {typedMissing && (
            <CardRow>
              <span className={styles.name}>{typed[0]}</span>
              <Button
                onClick={() =>
                  add.mutate({ owner: typed[1]!, name: typed[2]! })
                }
                disabled={add.isPending}
              >
                Add
              </Button>
            </CardRow>
          )}
          {options.map((repo) => (
            <RepoOptionRow
              key={repo.githubRepoId}
              repo={repo}
              onAdd={() => add.mutate({ owner: repo.owner, name: repo.name })}
              adding={add.isPending}
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

function RepoOptionRow({
  repo,
  onAdd,
  adding,
}: {
  repo: RepoOption;
  onAdd: () => void;
  adding: boolean;
}) {
  const name = `${repo.owner}/${repo.name}`;
  return (
    <CardRow>
      <span className={styles.name}>
        {name}
        {repo.isPrivate && <span className={styles.hint}>Private</span>}
      </span>
      {repo.watched ? (
        <span className={styles.hint}>Watching</span>
      ) : (
        <Button aria-label={`Add ${name}`} onClick={onAdd} disabled={adding}>
          Add
        </Button>
      )}
    </CardRow>
  );
}
