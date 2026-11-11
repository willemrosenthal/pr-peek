import {
  keptTimes,
  type ItemKind,
  type SettingsResponse,
  type UpdateRuleBody,
  type UpdateRuleResponse,
  type UpdateSettingsBody,
  type UpdateSettingsResponse,
  type UserSettingsDto,
} from "@pr-peek/core";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queries";
import { startListUpdate } from "./useListUpdate";

// Settings can change what's on the list, so it and its counts reload. A change to what
// the rules find takes a sync, so the list reloads again once it's done.
function reloadList(
  queryClient: QueryClient,
  listUpdatingSince: string | null,
) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.items });
  void queryClient.invalidateQueries({ queryKey: queryKeys.summary });
  if (listUpdatingSince) startListUpdate(queryClient, listUpdatingSince);
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
    onSuccess: ({ settings, listUpdatingSince }, changes) => {
      // Takes only the fields this save sent, so a slower answer to an earlier save
      // can't undo a later one.
      const sent = pick(settings, changes);
      queryClient.setQueryData<SettingsResponse>(
        queryKeys.settings,
        (old) => old && { ...old, settings: { ...old.settings, ...sent } },
      );
      reloadList(queryClient, listUpdatingSince);
    },
  });
}

// The fields of `from` that `keysOf` has, and the kept copies of times in it, which the
// server changes along with them.
function pick(
  from: UserSettingsDto,
  keysOf: UpdateSettingsBody,
): Partial<UserSettingsDto> {
  const wanted = new Set([
    ...Object.keys(keysOf),
    ...Object.keys(keptTimes(keysOf)),
  ]);
  return Object.fromEntries(
    Object.entries(from).filter(([key]) => wanted.has(key)),
  );
}

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
    onSuccess: ({ rule, listUpdatingSince }) => {
      queryClient.setQueryData<SettingsResponse>(
        queryKeys.settings,
        (old) =>
          old && {
            ...old,
            rules: old.rules.map((r) => (r.id === rule.id ? rule : r)),
          },
      );
      reloadList(queryClient, listUpdatingSince);
    },
  });
}
