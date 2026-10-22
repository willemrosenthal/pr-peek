import { ITEMS_CHANGED_EVENT, type SummaryResponse } from "@pr-peek/core";
import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { queryKeys } from "../queries";

// How long to wait before opening a stream the server closed.
export const RECONNECT_MS = 30_000;

// Keeps the list current. The server sends an event each time the user's items change.
export function useLiveUpdates() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const invalidate = (...keys: QueryKey[]) => {
      for (const queryKey of keys)
        void queryClient.invalidateQueries({ queryKey });
    };
    let source: EventSource;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let opened = false;

    const connect = () => {
      source = new EventSource("/api/stream");
      source.addEventListener("open", () => {
        // The server doesn't replay events, so catch up after a reconnect.
        if (opened)
          invalidate(queryKeys.items, queryKeys.summary, queryKeys.syncStatus);
        opened = true;
      });
      source.addEventListener(ITEMS_CHANGED_EVENT, (event) => {
        const summary = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as SummaryResponse;
        queryClient.setQueryData(queryKeys.summary, summary);
        invalidate(queryKeys.items, queryKeys.syncStatus);
      });
      source.addEventListener("error", () => {
        // The browser retries dropped connections itself, but not refused ones.
        if (source.readyState !== EventSource.CLOSED) return;
        // Sends a signed out user to sign in.
        invalidate(queryKeys.me);
        retry = setTimeout(connect, RECONNECT_MS);
      });
    };

    connect();
    return () => {
      clearTimeout(retry);
      source.close();
    };
  }, [queryClient]);
}
