import { Toggle } from "@base-ui/react/toggle";
import {
  addRepoBody,
  formatAge,
  type AddRepoBody,
  type AddRepoResponse,
  type RepoOption,
} from "@pr-peek/core";
import { useMutation } from "@tanstack/react-query";
import Fuse, { type IFuseOptions, type RangeTuple } from "fuse.js";
import { Check } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import { useDebounced } from "../hooks/useDebounced";
import { useNow } from "../hooks/useNow";
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
import { TextField } from "./Field";
import { ALL, OTHER, OwnerSelect } from "./OwnerSelect";
import styles from "./Repos.module.css";
import { Spinner } from "./Spinner";

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
  const list = useRepoList(owner);

  return (
    <div className={styles.picker}>
      <OwnerSelect
        value={shown}
        onChange={setPick}
        owners={listed}
        count={owner === undefined ? undefined : list.repos?.length}
        loadingMore={owner !== undefined && list.loadingMore}
      />
      {owners.isError && <Alert>{owners.error.message}</Alert>}
      {shown === OTHER && <OtherOwner name={other} onSubmit={setOther} />}
      {owner !== undefined && (
        <RepoResults
          owner={owner}
          list={list}
          filter={filter}
          onFilterChange={setFilter}
        />
      )}
    </div>
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

// One owner's repos, or all of the user's, narrowed down by the filter box.
function RepoResults({
  owner,
  list,
  filter: typedFilter,
  onFilterChange,
}: {
  owner: string | null;
  list: ReturnType<typeof useRepoList>;
  filter: string;
  onFilterChange: (filter: string) => void;
}) {
  const filter = typedFilter.trim();
  const now = useNow(60_000);
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

  const filterBox = (
    <FilterBox
      owner={owner}
      value={typedFilter}
      onChange={onFilterChange}
      // A typed owner/name is one repo, so a count would only confuse.
      count={list.repos && !typedRepo ? rows.length : undefined}
    />
  );
  if (list.isPending) {
    return (
      <>
        {filterBox}
        <p className={styles.hint}>Loading</p>
      </>
    );
  }
  // Like an unknown name in Other. A count and "no repos" would only repeat it.
  if (!list.repos) return <Alert>{list.error?.message}</Alert>;

  const shownRows = rows.slice(0, MAX_ROWS);

  return (
    <>
      {filterBox}
      {list.isError && <Alert>{list.error.message}</Alert>}
      {searched.isError && <Alert>{searched.error.message}</Alert>}
      {list.repos.some((repo) => repo.isFork) && (
        <Toggle
          className={styles.pill}
          pressed={showForks}
          onPressedChange={setShowForks}
        >
          Show forks
        </Toggle>
      )}
      {(shownRows.length > 0 || typedMissing || extra.length > 0) && (
        <Card label="Repos you can add">
          {typedMissing && (
            <AddRepoRow
              key={typedName}
              repo={typedRepo}
              isWatched={isWatched}
              now={now}
            />
          )}
          {[...shownRows, ...extra.map((repo): Row => ({ repo }))].map(
            (row) => (
              <AddRepoRow
                key={row.repo.githubRepoId}
                repo={row.repo}
                nameMatch={row.nameMatch}
                isWatched={isWatched}
                now={now}
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

// The filter, with how many repos match inside it on the right.
function FilterBox({
  owner,
  value,
  onChange,
  count,
}: {
  owner: string | null;
  value: string;
  onChange: (value: string) => void;
  count: number | undefined;
}) {
  return (
    <label className={styles.filter}>
      <input
        className={styles.filterInput}
        aria-label="Filter repos"
        type="search"
        placeholder={
          owner
            ? `Filter ${owner}'s repos, or owner/name`
            : "Filter all your repos"
        }
        autoCapitalize="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {count !== undefined && (
        <span className={styles.filterCount} aria-live="polite">
          {count.toLocaleString("en-US")}
          <span className="visually-hidden">
            {count === 1 ? " repo" : " repos"}
          </span>
        </span>
      )}
    </label>
  );
}

// How long since a push: "5h", "3mo", or "2y".
function pushedAge(pushedAt: string, now: Date) {
  const days = (now.getTime() - new Date(pushedAt).getTime()) / 86_400_000;
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  if (days >= 30) return `${Math.floor(days / 30)}mo`;
  return formatAge(pushedAt, now);
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
  now,
}: {
  repo: AddRepoBody &
    Partial<Pick<RepoOption, "isPrivate" | "isFork" | "pushedAt">>;
  nameMatch?: readonly RangeTuple[] | undefined;
  isWatched: (repo: AddRepoBody) => boolean;
  now: Date;
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
  // A typed repo knows only its name.
  const details = [
    repo.isPrivate === undefined ? null : repo.isPrivate ? "Private" : "Public",
    repo.isFork && "Fork",
    repo.pushedAt && `pushed ${pushedAge(repo.pushedAt, now)} ago`,
  ].filter(Boolean);

  return (
    <CardRow className={styles.addRow}>
      <span className={styles.repo}>
        <span className={styles.repoName}>
          <span className={styles.owner}>{repo.owner}/</span>
          <Highlighted text={repo.name} ranges={nameMatch} />
        </span>
        {details.length > 0 && (
          <span className={styles.hint}>{details.join(" · ")}</span>
        )}
      </span>
      {watched ? (
        <span className={styles.watching}>
          <Check size={16} strokeWidth={2.5} />
          Watching
        </span>
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
