import {
  daysLeft,
  EXPIRING_DAYS,
  plural,
  type TokenDto,
  type TokenKind,
  type TokensResponse,
} from "@pr-peek/core";
import type { Tone } from "./components/LinkRow";

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

// How many watched repos have one of `owners`. Logins ignore case on GitHub.
export function watchedReposOf(
  syncedBy: TokensResponse["syncedBy"],
  owners: string[],
) {
  const wanted = new Set(owners.map((owner) => owner.toLowerCase()));
  return syncedBy
    .filter((row) => wanted.has(row.owner.toLowerCase()))
    .reduce((sum, row) => sum + row.repos, 0);
}

export const kindLabel = (kind: TokenKind) =>
  kind === "classic" ? "Classic" : "Fine-grained";

// What a token reaches, to follow "Covers" or "It reaches".
export function reachText(
  token: { kind: TokenKind | null; owners: string[] },
  syncedBy: TokensResponse["syncedBy"],
) {
  if (token.kind === "classic") return "every repo your account can see";
  if (token.owners.length === 0) return "no private repos";
  const owners = token.owners.join(", ");
  // Before any repo is watched, like during onboarding, a count of 0 would only worry.
  if (syncedBy.length === 0) return owners;
  const repos = plural(watchedReposOf(syncedBy, token.owners), "repo");
  return `${owners}: ${repos} you watch`;
}

// How many watched repos a token syncs now.
export const reposSyncedBy = (
  syncedBy: TokensResponse["syncedBy"],
  tokenId: string,
) =>
  syncedBy
    .filter((row) => row.tokenId === tokenId)
    .reduce((sum, row) => sum + row.repos, 0);

export type TokenState = "working" | "expiring" | "stopped";

export function stateOf(token: TokenDto, now = Date.now()): TokenState {
  if (token.status === "stopped") return "stopped";
  if (token.expiresAt && daysLeft(token.expiresAt, now) <= EXPIRING_DAYS) {
    return "expiring";
  }
  return "working";
}

// A token's one-line summary for its row, like "Fine-grained · covers acme · 4 repos".
export function tokenSummary(
  token: TokenDto,
  syncedBy: TokensResponse["syncedBy"],
) {
  if (token.kind === "classic") return "Classic · every repo you can see";
  const kind = token.kind && kindLabel(token.kind);
  if (token.owners.length === 0) {
    return [kind, "no private repos"].filter(Boolean).join(" · ");
  }
  const watched = watchedReposOf(syncedBy, token.owners);
  return [
    kind,
    `covers ${token.owners.join(", ")}`,
    watched > 0 && plural(watched, "repo"),
  ]
    .filter(Boolean)
    .join(" · ");
}

// What's wrong with a token, in a few words, or null when it's working.
export function tokenProblem(token: TokenDto, now = Date.now()) {
  const state = stateOf(token, now);
  if (state === "stopped") return "Stopped working";
  if (state === "working") return null;
  const days = daysLeft(token.expiresAt!, now);
  return days > 0 ? `Expires in ${plural(days, "day")}` : "Expired";
}

// The color of a token's problem: red once it stopped, orange while it's expiring, and
// none while it's working.
export function tokenTone(token: TokenDto, now = Date.now()): Tone | undefined {
  const state = stateOf(token, now);
  if (state === "stopped") return "danger";
  return state === "expiring" ? "warning" : undefined;
}
