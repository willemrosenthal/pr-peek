import {
  addRepoBody,
  type AddRepoBody,
  type AddRepoResponse,
  type RepoOption,
  type RepoOwner,
  type RepoOwnerKind,
} from "@pr-peek/core";
import { useMutation } from "@tanstack/react-query";
import Fuse, { type IFuseOptions, type RangeTuple } from "fuse.js";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import { useDebounced } from "../hooks/useDebounced";
import { useStoredState } from "../hooks/useStoredState";
import {
  MAX_REPO_PAGES,
  useReloadWatchList,
  useRepoList,
  useRepoOwners,
  useRepoSearch,
  useRepos,
} from "../queries";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Card, CardRow } from "./Card";
import { SelectField, TextField } from "./Field";
import styles from "./Repos.module.css";
import { Spinner } from "./Spinner";
import { Switch } from "./Switch";

// The owner menu's choices that aren't a GitHub name. No GitHub name starts with "*".
const ALL = "*all";
const OTHER = "*other";

const GROUPS: { kind: RepoOwnerKind; label: string }[] = [
  { kind: "you", label: "You" },
  { kind: "org", label: "Your orgs" },
  { kind: "shared", label: "Shared with you" },
];

// Most rows shown at once. Typing narrows down the rest.
const MAX_ROWS = 50;

// Waits for typing to pause before searching GitHub.
const SEARCH_DELAY_MS = 300;

// "owner/name", or a link to the repo, typed in full.
const FULL_NAME =
  /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

const isGitHubName = (name: string) =>
  addRepoBody.shape.owner.safeParse(name).success;

const isString = (value: unknown): value is string => typeof value === "string";

// GitHub names ignore case.
const fullName = (repo: AddRepoBody) =>
  `${repo.owner}/${repo.name}`.toLowerCase();

// Typos still match, and a match can be anywhere in the name.
const FUSE_OPTIONS: IFuseOptions<RepoOption> = {
  keys: [
    { name: "name", weight: 2 },
    { name: "owner", weight: 1 },
  ],
  threshold: 0.4,
  ignoreLocation: true,
  includeMatches: true,
};

interface Row {
  repo: RepoOption;
  // Where the filter matched the name, to highlight.
  nameMatch?: readonly RangeTuple[] | undefined;
}

// Pick an owner, then filter their repos, and add them to the watch list.
export function RepoPicker() {
  const owners = useRepoOwners();
  const [pick, setPick] = useStoredState("pr-peek:repo-owner", ALL, isString);
  const [other, setOther] = useStoredState(
    "pr-peek:repo-owner-other",
    "",
    isString,
  );
  const [filter, setFilter] = useState("");

  const listed = owners.data?.owners;
  const isListed = listed?.some((owner) => owner.login === pick) ?? true;
  // An owner the user has since left falls back to all.
  const shown = pick === ALL || pick === OTHER || isListed ? pick : ALL;
  // Null lists all the user's repos. Undefined waits for a name in Other.
  const owner =
    shown === ALL ? null : shown === OTHER ? other || undefined : shown;

  return (
    <div className={styles.picker}>
      <SelectField
        label="Add a repo from"
        value={shown}
        onChange={(e) => setPick(e.target.value)}
      >
        <option value={ALL}>All my repos</option>
        {listed
          ? GROUPS.map(({ kind, label }) => (
              <OwnerGroup
                key={kind}
                label={label}
                owners={listed.filter((o) => o.kind === kind)}
              />
            ))
          : // The remembered owner, until the menu loads.
            shown !== ALL &&
            shown !== OTHER && <option value={shown}>{shown}</option>}
        <option value={OTHER}>Other…</option>
      </SelectField>
      {owners.isError && <Alert>{owners.error.message}</Alert>}
      {shown === OTHER && <OtherOwner name={other} onSubmit={setOther} />}
      {owner !== undefined && (
        <>
          <TextField
            label="Filter repos"
            type="search"
            placeholder="Part of a name, or owner/name"
            autoCapitalize="off"
            spellCheck={false}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <RepoResults owner={owner} filter={filter.trim()} />
        </>
      )}
    </div>
  );
}

function OwnerGroup({ label, owners }: { label: string; owners: RepoOwner[] }) {
  if (owners.length === 0) return null;
  return (
    <optgroup label={label}>
      {owners.map(({ login }) => (
        <option key={login} value={login}>
          {login}
        </option>
      ))}
    </optgroup>
  );
}

// A box for any GitHub user or org's name.
function OtherOwner({
  name,
  onSubmit,
}: {
  name: string;
  onSubmit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  const typed = draft.trim();
  const valid = isGitHubName(typed);

  return (
    <form
      className={styles.other}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(typed);
      }}
    >
      <TextField
        label="GitHub user or org"
        placeholder="Like vercel"
        autoCapitalize="off"
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <Button type="submit" disabled={!valid}>
        Show repos
      </Button>
    </form>
  );
}

// One owner's repos, or all of the user's, narrowed down by `filter`.
function RepoResults({
  owner,
  filter,
}: {
  owner: string | null;
  filter: string;
}) {
  const list = useRepoList(owner);
  const [showForks, setShowForks] = useState(false);
  const isShown = useCallback(
    (repo: RepoOption) => showForks || !repo.isFork,
    [showForks],
  );
  const repos = useMemo(
    () => (list.repos ?? []).filter(isShown),
    [list.repos, isShown],
  );
  const fuse = useMemo(() => new Fuse(repos, FUSE_OPTIONS), [repos]);

  const typed = FULL_NAME.exec(filter);
  // Offers a typed owner/name the list doesn't have, like one from another owner or an
  // org that blocks Git Buddy.
  const typedRepo = typed && { owner: typed[1]!, name: typed[2]! };
  const typedName = typedRepo && fullName(typedRepo);
  const rows: Row[] = typedName
    ? repos
        .filter((repo) => fullName(repo) === typedName)
        .map((repo) => ({ repo }))
    : filter
      ? fuse.search(filter).map(({ item, matches }) => ({
          repo: item,
          nameMatch: matches?.find((m) => m.key === "name")?.indices,
        }))
      : repos.map((repo) => ({ repo }));
  const typedMissing = typedRepo && rows.length === 0;

  // The list stops at MAX_REPO_PAGES, so GitHub search finds the rest by name.
  const searchText = useDebounced(typedRepo ? "" : filter, SEARCH_DELAY_MS);
  const searched = useRepoSearch(list.truncated ? owner : null, searchText);
  const shownIds = new Set(rows.map(({ repo }) => repo.githubRepoId));
  const extra = (searched.data?.repos ?? []).filter(
    (repo) => !shownIds.has(repo.githubRepoId) && isShown(repo),
  );

  const repoList = useRepos();
  // The watch list decides "Watching", so the list doesn't load again after a change.
  const watched = new Set(repoList.data?.repos.map(fullName));
  const isWatched = (repo: AddRepoBody) => watched.has(fullName(repo));

  if (list.isPending) return <p className={styles.hint}>Loading</p>;
  // Like an unknown name in Other. A count and "no repos" would only repeat it.
  if (!list.repos) return <Alert>{list.error?.message}</Alert>;

  // A typed owner/name is one repo, so a count would only confuse.
  const count = typedRepo
    ? ""
    : filter
      ? `${rows.length} of ${repos.length} repos`
      : `${repos.length} repos`;
  const shownRows = rows.slice(0, MAX_ROWS);

  return (
    <>
      {list.isError && <Alert>{list.error.message}</Alert>}
      {searched.isError && <Alert>{searched.error.message}</Alert>}
      <div className={styles.listInfo}>
        <p className={styles.hint} aria-live="polite">
          {count && list.loadingMore ? `${count}, loading more` : count}
        </p>
        {list.repos?.some((repo) => repo.isFork) && (
          <label className={styles.forks}>
            <Switch
              label="Show forks"
              checked={showForks}
              onChange={setShowForks}
            />
            Show forks
          </label>
        )}
      </div>
      {(shownRows.length > 0 || typedMissing || extra.length > 0) && (
        <Card label="Repos you can add">
          {typedMissing && (
            <AddRepoRow
              key={typedName}
              repo={typedRepo}
              isWatched={isWatched}
            />
          )}
          {[...shownRows, ...extra.map((repo): Row => ({ repo }))].map(
            (row) => (
              <AddRepoRow
                key={row.repo.githubRepoId}
                repo={row.repo}
                nameMatch={row.nameMatch}
                isWatched={isWatched}
              />
            ),
          )}
        </Card>
      )}
      {rows.length > MAX_ROWS && (
        <p className={styles.hint}>
          Showing the first {MAX_ROWS}. Type more to narrow it down.
        </p>
      )}
      {!typedMissing && rows.length === 0 && extra.length === 0 && (
        <p className={styles.hint}>
          {filter ? `No repos match "${filter}".` : "No repos here to add."}
        </p>
      )}
      {list.truncated && (
        <p className={styles.hint}>
          {truncatedHint(
            owner,
            filter,
            // Also while typing, before the search starts.
            searched.isFetching || searchText !== filter,
          )}
        </p>
      )}
    </>
  );
}

function truncatedHint(owner: string | null, filter: string, busy: boolean) {
  const most = `${(MAX_REPO_PAGES * 100).toLocaleString("en-US")} most recently pushed`;
  if (!owner) {
    return `Showing your ${most} repos. Pick an owner to search all of theirs.`;
  }
  if (busy) return `Searching all of ${owner}'s repos`;
  return filter
    ? `Also searched all of ${owner}'s repos.`
    : `Showing the ${most}. Type a name to search all of ${owner}'s repos.`;
}

// `text`, with the parts the filter matched marked.
function Highlighted({
  text,
  ranges = [],
}: {
  text: string;
  ranges?: readonly RangeTuple[] | undefined;
}) {
  const parts: ReactNode[] = [];
  let at = 0;
  // Single letters matched by a typo are noise, so only runs of two or more.
  for (const [start, end] of ranges.filter(([s, e]) => e > s)) {
    parts.push(
      text.slice(at, start),
      <mark key={start} className={styles.mark}>
        {text.slice(start, end + 1)}
      </mark>,
    );
    at = end + 1;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

// One repo, with its own Add button, so several can be added at once.
function AddRepoRow({
  repo,
  nameMatch,
  isWatched,
}: {
  repo: AddRepoBody & Partial<Pick<RepoOption, "isPrivate" | "isFork">>;
  nameMatch?: readonly RangeTuple[] | undefined;
  isWatched: (repo: AddRepoBody) => boolean;
}) {
  const reloadWatchList = useReloadWatchList();
  const add = useMutation({
    mutationFn: () =>
      api<AddRepoResponse>("/repos", {
        method: "POST",
        body: { owner: repo.owner, name: repo.name },
      }),
    // Stays pending until the watch list shows the repo.
    onSuccess: reloadWatchList,
  });
  const name = `${repo.owner}/${repo.name}`;
  // GitHub may save a typed repo under its current name.
  const watched =
    isWatched(repo) || (add.isSuccess && isWatched(add.data.repo));

  return (
    <CardRow>
      <span className={styles.name}>
        <span>
          <span className={styles.owner}>{repo.owner}/</span>
          <Highlighted text={repo.name} ranges={nameMatch} />
        </span>
        {repo.isPrivate && <span className={styles.hint}>Private</span>}
        {repo.isFork && <span className={styles.hint}>Fork</span>}
      </span>
      {watched ? (
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
