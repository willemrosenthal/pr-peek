import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../../api";
import { setBadge } from "../../badge";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { Card, CardRow } from "../../components/Card";
import { Select } from "../../components/Field";
import { GitHubToken } from "../../components/GitHubToken";
import { RowText } from "../../components/RowText";
import { SettingSwitch } from "../../components/SettingSwitch";
import { Switch } from "../../components/Switch";
import {
  clearTrayState,
  coloredIcon,
  COUNT_STYLES,
  countStyle,
  inDesktopApp,
  launchAtLogin,
  setLaunchAtLogin,
  type CountStyle,
} from "../../desktop";
import { useLocalSetting } from "../../localSetting";
import { queryKeys, useMe, useSettings } from "../../queries";
import { TabHeading } from "./SettingsLayout";

export function GeneralTab() {
  const { data } = useMe();
  const settings = useSettings();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation({
    mutationFn: () => api("/auth/signout", { method: "POST" }),
    onSuccess: async () => {
      queryClient.clear();
      void setBadge(0);
      clearTrayState();
      await navigate("/signin", { replace: true });
    },
  });

  return (
    <>
      <TabHeading title="General">Signed in as {data?.user.login}</TabHeading>
      {settings.isError && <Alert>{settings.error.message}</Alert>}
      {settings.data && (
        <Card label="General settings">
          <SettingSwitch
            settings={settings.data.settings}
            field="hideBots"
            label="Hide bots"
            hint="Leaves out comments and reviews by bots, like dependabot and renovate."
          />
          <SettingSwitch
            settings={settings.data.settings}
            field="includeTeamRequests"
            label="Team review requests"
            hint="Lists PRs that ask one of your teams to review, not just you."
          />
        </Card>
      )}
      {inDesktopApp() && (
        <Card label="Menu bar">
          <LaunchAtLoginRow />
          <MenuBarCountRow />
          <ColoredIconRow />
        </Card>
      )}
      <GitHubToken />
      <div>
        <Button onClick={() => signOut.mutate()} disabled={signOut.isPending}>
          Sign out
        </Button>
      </div>
    </>
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
      <RowText
        label="Launch at login"
        hint="Opens Git Buddy in the menu bar when you log in to this Mac."
      />
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
      <RowText
        label="Menu bar count"
        hint="Next to the icon. Only on this Mac."
      />
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
      <RowText
        label="Colored icon"
        hint="Turns orange when a review is late, and red when a check fails. Off keeps it plain."
      />
      <Switch
        label="Colored icon"
        checked={colored}
        onChange={coloredIcon.set}
      />
    </CardRow>
  );
}
