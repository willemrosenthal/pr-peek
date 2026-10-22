import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../api";
import { Button } from "../components/Button";
import { GitHubToken } from "../components/GitHubToken";
import { useMe } from "../queries";
import styles from "./Home.module.css";

// Stands in for the list until plan 07 part 3. The token moves to settings in part 4.
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
    <main className={styles.page}>
      <div className={styles.panel}>
        <h1 className={styles.title}>Signed in as {data?.user.login}</h1>
        <p className={styles.hint}>The list is coming next.</p>
        <GitHubToken />
        <Button onClick={() => signOut.mutate()} disabled={signOut.isPending}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
