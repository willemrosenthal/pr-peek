import type {
  ItemsResponse,
  MeResponse,
  SearchReposResponse,
  SettingsResponse,
  SummaryResponse,
  SyncStatusResponse,
  WatchedReposResponse,
} from "@pr-peek/core";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, isUnauthorized } from "./api";

export const queryKeys = {
  me: ["me"],
  items: ["items"],
  summary: ["summary"],
  syncStatus: ["sync-status"],
  repos: ["repos"],
  githubRepos: ["github-repos"],
  settings: ["settings"],
} as const;

// Ages and stale colors change with time, so lists refetch this often.
export const REFETCH_MS = 60_000;

// The signed in user. Fails with a 401 ApiError when signed out.
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api<MeResponse>("/me"),
    // Signed out is an answer, not a failure to retry.
    retry: (count, err) => !isUnauthorized(err) && count < 2,
  });
}

export function useItems() {
  return useQuery({
    queryKey: queryKeys.items,
    queryFn: () => api<ItemsResponse>("/items"),
    refetchInterval: REFETCH_MS,
  });
}

// Counts for the app badge. The live stream also sets it.
export function useSummary() {
  return useQuery({
    queryKey: queryKeys.summary,
    queryFn: () => api<SummaryResponse>("/summary"),
    refetchInterval: REFETCH_MS,
  });
}

export function useRepos() {
  return useQuery({
    queryKey: queryKeys.repos,
    queryFn: () => api<WatchedReposResponse>("/repos"),
  });
}

// Repos the user could watch: their recent ones, or matches for `query`. Paged.
export function useRepoSearch(query: string) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.githubRepos, query],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (query) params.set("query", query);
      if (pageParam) params.set("cursor", pageParam);
      const search = params.size > 0 ? `?${params}` : "";
      return api<SearchReposResponse>(`/github/repos${search}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // Keeps the old results up while new ones load.
    placeholderData: keepPreviousData,
  });
}

// Reloads the watch list after a change to it.
export function useReloadWatchList() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.repos });
}

// The user's settings and every rule's.
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api<SettingsResponse>("/settings"),
  });
}

export function useSyncStatus(
  refetchInterval: (query: {
    state: { data: SyncStatusResponse | undefined; dataUpdatedAt: number };
  }) => number,
) {
  return useQuery({
    queryKey: queryKeys.syncStatus,
    queryFn: () => api<SyncStatusResponse>("/sync/status"),
    refetchInterval,
  });
}
