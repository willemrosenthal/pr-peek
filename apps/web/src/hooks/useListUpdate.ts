import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { queryKeys, useSyncStatus } from "../queries";
import { GIVE_UP_MS, POLL_MS } from "./useSync";

// A settings save that changed what the rules find. The server runs them again in the
// next sync.
interface ListUpdate {
  // The server's time for the save (`listUpdatingSince`).
  since: string;
  // This device's time, to give up waiting.
  at: number;
}

// Called after a save. Settings shows "Updating your list…" until the sync is done.
export function startListUpdate(queryClient: QueryClient, since: string) {
  const update: ListUpdate = { since, at: Date.now() };
  queryClient.setQueryData(queryKeys.listUpdate, update);
}

// A sync that started at or after the save ended, so it ran the rules again.
const caughtUp = (lastSyncedAt: string | null | undefined, since: string) =>
  !!lastSyncedAt && Date.parse(lastSyncedAt) >= Date.parse(since);

// True while the list catches up with a settings change, or 2 minutes at most. Checks
// the sync status often meanwhile, then reloads the list.
export function useListUpdating(): boolean {
  const queryClient = useQueryClient();
  const { data: update } = useQuery<ListUpdate | null>({
    queryKey: queryKeys.listUpdate,
    queryFn: () => null,
    staleTime: Infinity,
  });
  // Asks only while waiting.
  const status = useSyncStatus(() => POLL_MS, !!update);
  const done =
    !!update &&
    (caughtUp(status.data?.lastSyncedAt, update.since) ||
      status.dataUpdatedAt - update.at > GIVE_UP_MS);

  useEffect(() => {
    if (!done) return;
    queryClient.setQueryData(queryKeys.listUpdate, null);
    void queryClient.invalidateQueries({ queryKey: queryKeys.items });
    void queryClient.invalidateQueries({ queryKey: queryKeys.summary });
  }, [done, queryClient]);

  return !!update && !done;
}
