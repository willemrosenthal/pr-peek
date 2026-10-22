import { MAX_SEEN_IDS } from "@pr-peek/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { api } from "../api";
import { queryKeys } from "../queries";

const isVisible = () => document.visibilityState === "visible";

// Marks the unseen items `ids` seen once the user leaves the list, by hiding the tab
// or opening another page. Marking reorders rows, so waiting keeps the list still.
export function useMarkSeen(ids: string[]) {
  const queryClient = useQueryClient();
  const onScreen = useRef<string[]>([]);
  const shown = useRef(new Set<string>());
  const sent = useRef(new Set<string>());

  const flush = useCallback(() => {
    const unsent = [...shown.current]
      .filter((id) => !sent.current.has(id))
      .slice(0, MAX_SEEN_IDS);
    if (unsent.length === 0) return;
    for (const id of unsent) sent.current.add(id);
    api("/items/seen", {
      method: "POST",
      body: { ids: unsent },
      keepalive: true,
    })
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.items }))
      .catch(() => {
        // Tries again next time.
        for (const id of unsent) sent.current.delete(id);
      });
  }, [queryClient]);

  useEffect(() => {
    onScreen.current = ids;
    if (isVisible()) for (const id of ids) shown.current.add(id);
  }, [ids]);

  useEffect(() => {
    const onChange = () => {
      if (!isVisible()) flush();
      else for (const id of onScreen.current) shown.current.add(id);
    };
    document.addEventListener("visibilitychange", onChange);
    return () => {
      document.removeEventListener("visibilitychange", onChange);
      flush();
    };
  }, [flush]);
}
