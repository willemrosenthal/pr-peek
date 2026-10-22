import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../../api";
import { setBadge } from "../../badge";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { GitHubToken } from "../../components/GitHubToken";
import { SettingSwitch } from "../../components/SettingSwitch";
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
      <GitHubToken />
      <div>
        <Button onClick={() => signOut.mutate()} disabled={signOut.isPending}>
          Sign out
        </Button>
      </div>
    </>
  );
}
