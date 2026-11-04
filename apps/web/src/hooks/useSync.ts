import type { RequestSyncResponse, SyncStatusResponse } from "@pr-peek/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { queryKeys, REFETCH_MS, useSyncStatus } from "../queries";

// How often to check while a refresh runs, and when to give up waiting.
export const POLL_MS = 2_000;
export const GIVE_UP_MS = 2 * 60_000;

// The status when the refresh started.
interface Started {
  lastSyncedAt: string | null;
  syncError: SyncStatusResponse["syncError"];
  at: number;
}

// The sync status, plus "refresh now", which spins until the sync ends.
export function useSync() {
  const queryClient = useQueryClient();
  const [started, setStarted] = useState<Started | null>(null);
  const isRunning = (data: SyncStatusResponse | undefined, checkedAt: number) =>
    started !== null &&
    data !== undefined &&
    !syncEnded(started, data, checkedAt);

  const status = useSyncStatus((query) =>
    isRunning(query.state.data, query.state.dataUpdatedAt)
      ? POLL_MS
      : REFETCH_MS,
  );
  const refreshing = isRunning(status.data, status.dataUpdatedAt);

  const refresh = useMutation({
    mutationFn: () => api<RequestSyncResponse>("/sync", { method: "POST" }),
    onMutate: () =>
      setStarted({
        lastSyncedAt: status.data?.lastSyncedAt ?? null,
        syncError: status.data?.syncError ?? null,
        at: Date.now(),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus }),
    onError: async (err) => {
      setStarted(null);
      // The token stopped working. The banner comes from the user's details.
      if (err instanceof ApiError && err.status === 401) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      }
    },
  });

  // The Mac menu bar app's Refresh menu item.
  const { mutate } = refresh;
  useEffect(() => {
    const onRefresh = () => mutate();
    window.addEventListener("pr-peek:refresh", onRefresh);
    return () => window.removeEventListener("pr-peek:refresh", onRefresh);
  }, [mutate]);

  // Loads the list the sync just updated.
  const finished = started !== null && !refreshing;
  useEffect(() => {
    if (finished)
      void queryClient.invalidateQueries({ queryKey: queryKeys.items });
  }, [finished, queryClient]);

  return {
    status: status.data,
    refreshing: refreshing || refresh.isPending,
    refresh: () => refresh.mutate(),
    // Only errors worth showing. A stopped token shows as a banner instead.
    refreshError:
      refresh.error instanceof ApiError && refresh.error.status === 401
        ? null
        : refresh.error,
  };
}

// A sync finished, failed, or took too long to wait for.
function syncEnded(
  started: Started,
  status: SyncStatusResponse,
  checkedAt: number,
): boolean {
  return (
    status.lastSyncedAt !== started.lastSyncedAt ||
    status.syncError !== started.syncError ||
    checkedAt - started.at > GIVE_UP_MS
  );
}
