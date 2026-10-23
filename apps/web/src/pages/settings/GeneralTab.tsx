import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  COUNT_STYLES,
  inDesktopApp,
  setCountStyle,
  type CountStyle,
} from "../../desktop";
import { useCountStyle } from "../../hooks/useCountStyle";
import { useMe, useSettings } from "../../queries";
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
          <MenuBarCountRow />
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

// Kept on this Mac, since only its menu bar uses it.
function MenuBarCountRow() {
  const style = useCountStyle();
  return (
    <CardRow>
      <RowText
        label="Menu bar count"
        hint="Next to the icon. Only on this Mac."
      />
      <Select
        aria-label="Menu bar count"
        value={style}
        onChange={(e) => setCountStyle(e.target.value as CountStyle)}
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
