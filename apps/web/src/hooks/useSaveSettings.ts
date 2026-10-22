import type {
  ItemKind,
  SettingsResponse,
  UpdateRuleBody,
  UpdateRuleResponse,
  UpdateSettingsBody,
  UpdateSettingsResponse,
  UserSettingsDto,
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
    onSuccess: ({ settings }, changes) => {
      // Takes only the fields this save sent, so a slower answer to an earlier save
      // can't undo a later one.
      const sent = pick(settings, changes);
      queryClient.setQueryData<SettingsResponse>(
        queryKeys.settings,
        (old) => old && { ...old, settings: { ...old.settings, ...sent } },
      );
      reloadList(queryClient);
    },
  });
}

// The fields of `from` that `keysOf` has.
const pick = (from: object, keysOf: object): Partial<UserSettingsDto> =>
  Object.fromEntries(
    Object.entries(from).filter(([key]) => Object.hasOwn(keysOf, key)),
  );

// Saves settings, and shows them with the values being saved, so a control shows its
// new value right away.
export function useSettingsSaver(settings: UserSettingsDto) {
  const save = useSaveSettings();
  // Holds only the fields being sent.
  const saving = save.isPending
    ? (save.variables as Partial<UserSettingsDto>)
    : {};
  return { save, shown: { ...settings, ...saving } };
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
