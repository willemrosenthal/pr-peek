import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../../api";
import { setBadge } from "../../badge";
import { Button } from "../../components/Button";
import { GitHubToken } from "../../components/GitHubToken";
import { useMe } from "../../queries";
import { TabHeading } from "./SettingsLayout";

export function GeneralTab() {
  const { data } = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation({
    mutationFn: () => api("/auth/signout", { method: "POST" }),
    onSuccess: async () => {
      queryClient.clear();
      setBadge(0);
      await navigate("/signin", { replace: true });
    },
  });

  return (
    <>
      <TabHeading title="General">Signed in as {data?.user.login}</TabHeading>
      <GitHubToken />
      <div>
        <Button onClick={() => signOut.mutate()} disabled={signOut.isPending}>
          Sign out
        </Button>
      </div>
    </>
  );
}
