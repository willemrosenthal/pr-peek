import type { UserSettingsDto } from "@pr-peek/core";
import { useSaveSettings } from "../hooks/useSaveSettings";
import { Alert } from "./Alert";
import { CardRow } from "./Card";
import { RowText } from "./RowText";
import { Switch } from "./Switch";

type OnOffSetting = {
  [K in keyof UserSettingsDto]: UserSettingsDto[K] extends boolean ? K : never;
}[keyof UserSettingsDto];

// A row that turns one setting on or off. Shows the new state while it saves.
export function SettingSwitch({
  settings,
  field,
  label,
  hint,
}: {
  settings: UserSettingsDto;
  field: OnOffSetting;
  label: string;
  hint?: string | undefined;
}) {
  const save = useSaveSettings();
  const on = save.isPending
    ? (save.variables[field] ?? settings[field])
    : settings[field];

  return (
    <CardRow>
      <RowText label={label} hint={hint} />
      <Switch
        label={label}
        checked={on}
        onChange={(checked) => save.mutate({ [field]: checked })}
        disabled={save.isPending}
      />
      {save.isError && <Alert>{save.error.message}</Alert>}
    </CardRow>
  );
}
