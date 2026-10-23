import {
  ITEMS_CHANGED_EVENT,
  NOTIFY_EVENT,
  type PushPayload,
  type SummaryResponse,
} from "@pr-peek/core";
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
      // For the Mac menu bar app, which shows it natively. Browser tabs ignore it.
      source.addEventListener(NOTIFY_EVENT, (event) => {
        const payload = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as PushPayload;
        window.dispatchEvent(
          new CustomEvent("pr-peek:notify", { detail: payload }),
        );
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

    // After sleep or a network change, a stream can look open but be dead. Starts over,
    // and the "open" handler catches up.
    const reconnect = () => {
      clearTimeout(retry);
      source.close();
      connect();
    };

    connect();
    window.addEventListener("online", reconnect);
    window.addEventListener("pr-peek:wake", reconnect);
    return () => {
      clearTimeout(retry);
      source.close();
      window.removeEventListener("online", reconnect);
      window.removeEventListener("pr-peek:wake", reconnect);
    };
  }, [queryClient]);
}
