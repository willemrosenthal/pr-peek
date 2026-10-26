import type {
  ItemDto,
  ItemsResponse,
  MeResponse,
  PrPreviewResponse,
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
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { api, ApiError, isUnauthorized } from "./api";
import { thisDeviceEndpoint } from "./push";
import { moveQuiet } from "./quiet";
import { markUnread } from "./unread";

export const queryKeys = {
  me: ["me"],
  items: ["items"],
  preview: ["preview"],
  summary: ["summary"],
  syncStatus: ["sync-status"],
  repos: ["repos"],
  githubRepos: ["github-repos"],
  settings: ["settings"],
  pushKey: ["push-key"],
  devices: ["devices"],
  thisDevice: ["this-device"],
  launchAtLogin: ["launch-at-login"],
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

const SET_QUIET = ["set-quiet"];

// Quiets a PR until something new happens on it, or brings it back. The row moves
// right away, then the list and counts reload.
export function useSetQuiet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: SET_QUIET,
    mutationFn: ({ prId, quiet }: { prId: string; quiet: boolean }) =>
      api(`/prs/${prId}/quiet`, { method: quiet ? "PUT" : "DELETE" }),
    onMutate: async ({ prId, quiet }) => {
      // Stops a list that's loading from undoing the move.
      await queryClient.cancelQueries({ queryKey: queryKeys.items });
      queryClient.setQueryData<ItemsResponse>(
        queryKeys.items,
        (old) => old && moveQuiet(old, prId, quiet),
      );
    },
    onSettled: () => {
      // Waits for the last of several quick saves, so a reload doesn't undo a later move.
      // This save still counts until it settles.
      if (queryClient.isMutating({ mutationKey: SET_QUIET }) > 1) return;
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.items }),
        queryClient.invalidateQueries({ queryKey: queryKeys.summary }),
      ]);
    },
  });
}

const SET_UNREAD = ["set-unread"];

// Marks a PR unread, as a reminder to come back to it, or read. The dot changes right
// away, then the list reloads.
export function useSetUnread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: SET_UNREAD,
    mutationFn: ({ prId, unread }: { prId: string; unread: boolean }) =>
      api(`/prs/${prId}/unread`, {
        method: unread ? "PUT" : "DELETE",
        // Opening the PR marks it read, and can hide the page before this is sent.
        keepalive: true,
      }),
    onMutate: async ({ prId, unread }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.items });
      queryClient.setQueryData<ItemsResponse>(
        queryKeys.items,
        (old) => old && markUnread(old, prId, unread),
      );
    },
    onSettled: () => {
      // Like useSetQuiet: only the last of several quick saves reloads.
      if (queryClient.isMutating({ mutationKey: SET_UNREAD }) > 1) return;
      return queryClient.invalidateQueries({ queryKey: queryKeys.items });
    },
  });
}

// Marks a PR read if the user marked it unread. Called when they open it.
export function useReadIfMarked() {
  const { mutate } = useSetUnread();
  return useCallback(
    (pr: ItemDto["pr"]) => {
      if (pr.markedUnread) mutate({ prId: pr.id, unread: false });
    },
    [mutate],
  );
}

// More about one PR, for the preview sheet. `itemId` is the row's item, if it has one.
function previewOptions(prId: string, itemId: string | null) {
  const query = itemId ? `?item=${encodeURIComponent(itemId)}` : "";
  return queryOptions({
    queryKey: [...queryKeys.preview, prId, itemId],
    queryFn: () => api<PrPreviewResponse>(`/prs/${prId}/preview${query}`),
    // Opening it again soon after doesn't ask GitHub again.
    staleTime: REFETCH_MS,
  });
}

export function usePrPreview(prId: string, itemId: string | null) {
  return useQuery(previewOptions(prId, itemId));
}

// Starts loading a preview, so it's ready sooner when it opens.
export function usePrefetchPreview() {
  const queryClient = useQueryClient();
  return useCallback(
    (prId: string, itemId: string | null) =>
      void queryClient.prefetchQuery(previewOptions(prId, itemId)),
    [queryClient],
  );
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
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
        queryClient.invalidateQueries({ queryKey: queryKeys.thisDevice }),
      ]),
    [queryClient],
  );
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
