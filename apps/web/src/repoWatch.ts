import type { UpdateRepoBody, WatchedRepoDto } from "@pr-peek/core";

// How Git Buddy watches a repo: on the list with notifications, on the list without
// them (muted), or not checked at all (paused).
export type Watch = "notify" | "list" | "paused";

export const watchOf = (repo: WatchedRepoDto): Watch =>
  !repo.enabled ? "paused" : repo.muted ? "list" : "notify";

export const WATCH_LABELS: Record<Watch, string> = {
  notify: "Notify",
  list: "List only",
  paused: "Paused",
};

// What to send to switch a repo to each. Pausing keeps whether it was muted.
export const WATCH_CHANGES: Record<Watch, UpdateRepoBody> = {
  notify: { enabled: true, muted: false },
  list: { enabled: true, muted: true },
  paused: { enabled: false },
};

// The colors a repo can pick from, before picking its own.
export const REPO_COLORS = [
  { value: "#2563eb", label: "Blue" },
  { value: "#16a34a", label: "Green" },
  { value: "#db2777", label: "Pink" },
  { value: "#ea580c", label: "Orange" },
  { value: "#7c3aed", label: "Purple" },
  { value: "#0891b2", label: "Teal" },
  { value: "#ca8a04", label: "Yellow" },
  { value: "#e11d48", label: "Red" },
];

// The repos grouped by owner, owners in the order they first appear.
export function byOwner(repos: WatchedRepoDto[]) {
  const groups = new Map<string, WatchedRepoDto[]>();
  for (const repo of repos) {
    groups.set(repo.owner, [...(groups.get(repo.owner) ?? []), repo]);
  }
  return [...groups];
}
