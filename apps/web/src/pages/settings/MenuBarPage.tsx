import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router";
import { Alert } from "../../components/Alert";
import { CardRow } from "../../components/Card";
import { Select } from "../../components/Field";
import { Group } from "../../components/Group";
import { RowText } from "../../components/RowText";
import { Switch } from "../../components/Switch";
import {
  coloredIcon,
  COUNT_STYLES,
  countStyle,
  inDesktopApp,
  launchAtLogin,
  setLaunchAtLogin,
  type CountStyle,
} from "../../desktop";
import { useLocalSetting } from "../../localSetting";
import { queryKeys } from "../../queries";
import { SettingsPage } from "./SettingsLayout";

// The Mac app's menu bar icon. Only in the Mac app.
export function MenuBarPage() {
  if (!inDesktopApp()) return <Navigate to="/settings" replace />;
  return (
    <SettingsPage title="Menu bar">
      <Group label="Menu bar">
        <LaunchAtLoginRow />
      </Group>
      <Group
        title="Icon"
        aside="This Mac"
        footer="Colored turns the icon orange when a review is late, and red when a check fails."
      >
        <MenuBarCountRow />
        <ColoredIconRow />
      </Group>
    </SettingsPage>
  );
}

// The same switch as "Launch at login" in the menu bar icon's right click menu.
function LaunchAtLoginRow() {
  const queryClient = useQueryClient();
  const state = useQuery({
    queryKey: queryKeys.launchAtLogin,
    queryFn: launchAtLogin,
  });
  const save = useMutation({
    mutationFn: setLaunchAtLogin,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.launchAtLogin }),
  });
  // Shows the new state while it saves.
  const on = save.isPending ? save.variables : (state.data ?? false);

  return (
    <CardRow>
      <RowText label="Launch at login" />
      <Switch
        label="Launch at login"
        checked={on}
        onChange={(checked) => save.mutate(checked)}
        disabled={state.isPending || save.isPending}
      />
      {save.isError && <Alert>Couldn't change it. Try again.</Alert>}
    </CardRow>
  );
}

// Kept on this Mac, since only its menu bar uses it.
function MenuBarCountRow() {
  const style = useLocalSetting(countStyle);
  return (
    <CardRow>
      <RowText label="Count" />
      <Select
        aria-label="Menu bar count"
        value={style}
        onChange={(e) => countStyle.set(e.target.value as CountStyle)}
      >
        {COUNT_STYLES.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
    </CardRow>
  );
}

// Kept on this Mac, like the count.
function ColoredIconRow() {
  const colored = useLocalSetting(coloredIcon);
  return (
    <CardRow>
      <RowText label="Colored icon" />
      <Switch
        label="Colored icon"
        checked={colored}
        onChange={coloredIcon.set}
      />
    </CardRow>
  );
}
