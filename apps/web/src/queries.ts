import type {
  ItemsResponse,
  MeResponse,
  SearchReposResponse,
  SummaryResponse,
  SyncStatusResponse,
  WatchedReposResponse,
} from "@pr-peek/core";
import {
  keepPreviousData,
  type InfiniteData,
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

// Updates the app after the watch list changes.
export function useWatchListChanged() {
  const queryClient = useQueryClient();
  // Reloads the watch list.
  const reload = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.repos });
  return {
    reload,
    // Also flips the repo in the search results, so GitHub isn't searched again.
    setWatched: (githubRepoId: number, watched: boolean) => {
      queryClient.setQueriesData<InfiniteData<SearchReposResponse>>(
        { queryKey: queryKeys.githubRepos },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              repos: page.repos.map((repo) =>
                repo.githubRepoId === githubRepoId
                  ? { ...repo, watched }
                  : repo,
              ),
            })),
          },
      );
      return reload();
    },
  };
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
