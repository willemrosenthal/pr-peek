import type {
  AddPrResponse,
  ItemDto,
  ItemsResponse,
  MeResponse,
  PrLookupResponse,
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
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { api, ApiError, isUnauthorized } from "./api";
import { markImportant } from "./important";
import { thisDeviceEndpoint } from "./push";
import { moveQuiet } from "./quiet";

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
  // Kept on this device only, by useListUpdate.
  listUpdate: ["list-update"],
  prLookup: ["pr-lookup"],
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

// Every save that changes the list right away, before the server answers: quiet and
// important. They share this key's start, so they wait for each other below.
const LIST_CHANGE = ["list-change"];

// Shows `change` on the list right away, then reloads the list and counts once the
// last of these saves settles, so a reload doesn't undo a later change. A save still
// counts until it settles.
function changesList<Save>(
  queryClient: QueryClient,
  change: (list: ItemsResponse, save: Save) => ItemsResponse,
) {
  return {
    onMutate: async (save: Save) => {
      // Stops a list that's loading from undoing the change.
      await queryClient.cancelQueries({ queryKey: queryKeys.items });
      queryClient.setQueryData<ItemsResponse>(
        queryKeys.items,
        (old) => old && change(old, save),
      );
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: LIST_CHANGE }) > 1) return;
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.items }),
        queryClient.invalidateQueries({ queryKey: queryKeys.summary }),
      ]);
    },
  };
}

// The PR a link names, for the add dialog. Off until there's a link. Each lookup asks
// GitHub, so one that failed isn't tried again on its own.
export function usePrLookup(link: string | null) {
  return useQuery({
    queryKey: [...queryKeys.prLookup, link],
    queryFn: () =>
      api<PrLookupResponse>(`/prs/lookup?link=${encodeURIComponent(link!)}`),
    enabled: link !== null,
    retry: false,
    staleTime: 60_000,
  });
}

// Adds a PR by its link, flagged. The list reloads to show it.
export function useAddPr() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (link: string) =>
      api<AddPrResponse>("/prs", { method: "POST", body: { link } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.items }),
        queryClient.invalidateQueries({ queryKey: queryKeys.summary }),
        queryClient.invalidateQueries({ queryKey: queryKeys.prLookup }),
      ]);
    },
  });
}

// Quiets a PR until something new happens on it, or brings it back. The row moves
// right away.
export function useSetQuiet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...LIST_CHANGE, "quiet"],
    mutationFn: ({ prId, quiet }: { prId: string; quiet: boolean }) =>
      api(`/prs/${prId}/quiet`, { method: quiet ? "PUT" : "DELETE" }),
    ...changesList(queryClient, (list, { prId, quiet }) =>
      moveQuiet(list, prId, quiet),
    ),
  });
}

// Marks a PR important, as a reminder to come back to it, or unmarks it. The flag
// changes right away. Returns a function that flips a PR's mark.
export function useToggleImportant() {
  const queryClient = useQueryClient();
  const { mutate } = useMutation({
    mutationKey: [...LIST_CHANGE, "important"],
    mutationFn: ({ prId, important }: { prId: string; important: boolean }) =>
      api(`/prs/${prId}/important`, { method: important ? "PUT" : "DELETE" }),
    ...changesList(queryClient, (list, { prId, important }) =>
      markImportant(list, prId, important),
    ),
  });
  return useCallback(
    (pr: ItemDto["pr"]) => mutate({ prId: pr.id, important: !pr.important }),
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
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.syncStatus,
    queryFn: () => api<SyncStatusResponse>("/sync/status"),
    refetchInterval,
    enabled,
  });
}
