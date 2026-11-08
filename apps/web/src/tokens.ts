import type { TokenDto, TokensResponse } from "@pr-peek/core";

const DAY_MS = 24 * 60 * 60 * 1000;
// A token this close to expiring offers Replace, like one that stopped.
const REPLACE_WITHIN_DAYS = 7;

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

export const daysLeft = (iso: string, now = Date.now()) =>
  Math.ceil((Date.parse(iso) - now) / DAY_MS);

export const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

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
  if (
    token.expiresAt &&
    daysLeft(token.expiresAt, now) <= REPLACE_WITHIN_DAYS
  ) {
    return "expiring";
  }
  return "working";
}
