import type {
  ItemKind,
  SettingsResponse,
  UpdateRuleBody,
  UpdateRuleResponse,
  UpdateSettingsBody,
  UpdateSettingsResponse,
} from "@pr-peek/core";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queries";

// Settings can change what's on the list, so it and its counts reload.
function reloadList(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.items });
  void queryClient.invalidateQueries({ queryKey: queryKeys.summary });
}

// Saves some of the user's settings.
export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: UpdateSettingsBody) =>
      api<UpdateSettingsResponse>("/settings", {
        method: "PATCH",
        body: changes,
      }),
    onSuccess: ({ settings }) => {
      queryClient.setQueryData<SettingsResponse>(
        queryKeys.settings,
        (old) => old && { ...old, settings },
      );
      reloadList(queryClient);
    },
  });
}

// Saves some of one rule's settings.
export function useSaveRule(ruleId: ItemKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: UpdateRuleBody) =>
      api<UpdateRuleResponse>(`/rules/${ruleId}`, {
        method: "PATCH",
        body: changes,
      }),
    onSuccess: ({ rule }) => {
      queryClient.setQueryData<SettingsResponse>(
        queryKeys.settings,
        (old) =>
          old && {
            ...old,
            rules: old.rules.map((r) => (r.id === rule.id ? rule : r)),
          },
      );
      reloadList(queryClient);
    },
  });
}
