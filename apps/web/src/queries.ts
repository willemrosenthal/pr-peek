import type {
  ItemsResponse,
  MeResponse,
  PushKeyResponse,
  PushSubscriptionsResponse,
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
import { api, ApiError, isUnauthorized } from "./api";
import { thisDeviceEndpoint } from "./push";

export const queryKeys = {
  me: ["me"],
  items: ["items"],
  summary: ["summary"],
  syncStatus: ["sync-status"],
  repos: ["repos"],
  githubRepos: ["github-repos"],
  settings: ["settings"],
  pushKey: ["push-key"],
  devices: ["devices"],
  thisDevice: ["this-device"],
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

// The VAPID public key. A 503 means push is off on this server, which retrying won't fix.
export function usePushKey(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.pushKey,
    queryFn: () => api<PushKeyResponse>("/push/key"),
    enabled,
    retry: false,
    staleTime: Infinity,
  });
}

export const isPushOff = (err: unknown) =>
  err instanceof ApiError && err.code === "push_off";

// Devices that get the user's notifications.
export function useDevices() {
  return useQuery({
    queryKey: queryKeys.devices,
    queryFn: () => api<PushSubscriptionsResponse>("/push/subscriptions"),
  });
}

// This browser's push endpoint, or null.
export function useThisDevice() {
  return useQuery({
    queryKey: queryKeys.thisDevice,
    queryFn: thisDeviceEndpoint,
  });
}

// Reloads the device list after a change, and which one is this browser.
export function useReloadDevices() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
      queryClient.invalidateQueries({ queryKey: queryKeys.thisDevice }),
    ]);
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
