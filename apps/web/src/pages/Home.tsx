import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../api";
import { Button } from "../components/Button";
import { PageMessage } from "../components/PageMessage";
import { useMe } from "../queries";

// Stands in for the list until plan 07 part 2.
export function Home() {
  const { data } = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation({
    mutationFn: () => api("/auth/signout", { method: "POST" }),
    onSuccess: async () => {
      queryClient.clear();
      await navigate("/signin", { replace: true });
    },
  });

  return (
    <PageMessage title={`Signed in as ${data?.user.login ?? ""}`}>
      <p>The list is coming next.</p>
      <Button onClick={() => signOut.mutate()} disabled={signOut.isPending}>
        Sign out
      </Button>
    </PageMessage>
  );
}
