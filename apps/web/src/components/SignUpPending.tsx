import type { MeResponse } from "@pr-peek/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import { Alert } from "./Alert";
import { Button } from "./Button";
import styles from "./SignUpPending.module.css";

// What someone sees until an admin approves their sign-up request. The server answers
// 403 to everything else, so nothing else loads.
export function SignUpPending({
  user,
  checking,
  onCheck,
}: {
  user: MeResponse["user"];
  // Asking the server again, and whether it's still asking.
  checking: boolean;
  onCheck: () => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [withdrawing, setWithdrawing] = useState(false);
  const leave = async () => {
    queryClient.clear();
    await navigate("/signin", { replace: true });
  };
  const signOut = useMutation({
    mutationFn: () => api("/auth/signout", { method: "POST" }),
    onSuccess: leave,
  });
  const withdraw = useMutation({
    mutationFn: () => api("/me", { method: "DELETE" }),
    onSuccess: leave,
  });
  const error = signOut.error ?? withdraw.error;

  return (
    <main className={styles.page}>
      <h1 className={styles.brand}>Git Buddy</h1>
      <section className={styles.card} aria-labelledby="pending-title">
        <div className={styles.who}>
          {user.avatarUrl && (
            <img className={styles.avatar} src={user.avatarUrl} alt="" />
          )}
          <div>
            <h2 id="pending-title" className={styles.title}>
              Thanks, {user.login}. Your request is in.
            </h2>
            <p className={styles.hint}>Signed in with GitHub</p>
          </div>
        </div>
        <p>
          Git Buddy is invite only for now. You'll get in once your request is
          approved. Come back to this page then to set up your list.
        </p>
        <p>Until then, Git Buddy doesn't look at any of your repos.</p>
        {error && <Alert>{error.message}</Alert>}
        <div className={styles.actions}>
          <Button onClick={onCheck} disabled={checking}>
            {checking ? "Checking" : "Check again"}
          </Button>
          <Button onClick={() => signOut.mutate()} disabled={signOut.isPending}>
            Sign out
          </Button>
        </div>
      </section>
      {withdrawing ? (
        <div className={styles.withdraw} role="group" aria-label="Withdraw">
          <p>
            Withdraw your request? Git Buddy deletes what it has: your GitHub
            name, picture, and sign in.
          </p>
          <div className={styles.actions}>
            <Button
              onClick={() => withdraw.mutate()}
              disabled={withdraw.isPending}
            >
              Withdraw
            </Button>
            <Button onClick={() => setWithdrawing(false)}>Keep it</Button>
          </div>
        </div>
      ) : (
        <p className={styles.hint}>
          Changed your mind?{" "}
          <Button variant="link" onClick={() => setWithdrawing(true)}>
            Withdraw your request
          </Button>
        </p>
      )}
    </main>
  );
}
