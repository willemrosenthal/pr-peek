import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { Button } from "../components/Button";
import { GitHubToken } from "../components/GitHubToken";
import { useMe } from "../queries";
import styles from "./Settings.module.css";

// A first settings page. Plan 07 part 4 turns it into tabs.
export function Settings() {
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
        <Link to="/">Back to your list</Link>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.hint}>Signed in as {data?.user.login}</p>
        <GitHubToken />
        <Button onClick={() => signOut.mutate()} disabled={signOut.isPending}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
