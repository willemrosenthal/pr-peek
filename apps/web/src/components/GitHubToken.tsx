import type { GitHubTokenDto, GitHubTokenResponse } from "@pr-peek/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "../api";
import { queryKeys, useMe } from "../queries";
import { Alert } from "./Alert";
import { Button } from "./Button";
import styles from "./GitHubToken.module.css";
import { TextField } from "./Field";

// Shows, adds, replaces, or removes the user's personal access token.
export function GitHubToken() {
  const token = useMe().data?.githubToken ?? null;
  const [replacing, setReplacing] = useState(false);

  if (token && !token.invalid && !replacing) {
    return <TokenInUse token={token} onReplace={() => setReplacing(true)} />;
  }
  return (
    <section className={styles.section}>
      {token?.invalid ? (
        <>
          <h2 className={styles.heading}>Your token stopped working</h2>
          <p className={styles.hint}>
            It may have expired. Syncs are paused until you add a new one.
          </p>
        </>
      ) : (
        <>
          <h2 className={styles.heading}>Use a personal access token</h2>
          <p className={styles.hint}>
            For orgs that block Git Buddy's GitHub app. Syncs use the token
            instead of your GitHub sign in.
          </p>
        </>
      )}
      <TokenSteps />
      <TokenForm
        onSaved={() => setReplacing(false)}
        onCancel={replacing ? () => setReplacing(false) : undefined}
      />
    </section>
  );
}

function TokenInUse({
  token,
  onReplace,
}: {
  token: GitHubTokenDto;
  onReplace: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api("/github-token", { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.me }),
  });
  const expires = token.expiresAt
    ? `Expires ${new Date(token.expiresAt).toLocaleDateString(undefined, { dateStyle: "medium" })}.`
    : "Never expires.";

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Personal access token</h2>
      <p className={styles.hint}>Syncs use your token. {expires}</p>
      {/* Kept here so the permissions can be checked against a token in use. */}
      <TokenSteps />
      {remove.isError && <Alert>{remove.error.message}</Alert>}
      <div className={styles.actions}>
        <Button onClick={onReplace}>Replace</Button>
        <Button onClick={() => remove.mutate()} disabled={remove.isPending}>
          Remove
        </Button>
      </div>
    </section>
  );
}

// How to make each kind of token, each in a section that opens on click.
function TokenSteps() {
  return (
    <div className={styles.kinds}>
      <details className={styles.kind}>
        <summary className={styles.summary}>Classic token</summary>
        <div className={styles.kindBody}>
          <p className={styles.hint}>
            Easiest. Works for all your repos and orgs.
          </p>
          <ol className={styles.steps}>
            <li>
              On GitHub, go to Settings, Developer settings, Personal access
              tokens, <strong>Tokens (classic)</strong>, then Generate new token
              (classic).
            </li>
            <li>
              Tick <code>repo</code> (its sub-boxes tick with it) and{" "}
              <code>read:org</code>. Leave the rest. For public repos only, tick
              just <code>public_repo</code> instead of <code>repo</code>. Pick
              an expiry you're happy with. You'll paste a new token when it runs
              out.
            </li>
            <li>
              If your company uses single sign-on, click{" "}
              <strong>Configure SSO</strong>, then <strong>Authorize</strong>{" "}
              next to your org. Without this, work repos won't show up.
            </li>
            <li>Copy the token and paste it here.</li>
          </ol>
        </div>
      </details>
      <details className={styles.kind}>
        <summary className={styles.summary}>Fine-grained token</summary>
        <div className={styles.kindBody}>
          <p className={styles.hint}>
            For orgs that only allow fine-grained tokens. Each one works for a
            single org or account, so PRs elsewhere won't show up. GitHub
            doesn't let these tokens read check runs, so failed GitHub Actions
            checks aren't named. Whether checks passed still shows.
          </p>
          <ol className={styles.steps}>
            <li>
              On GitHub, go to Settings, Developer settings, Personal access
              tokens, <strong>Fine-grained tokens</strong>, then Generate new
              token.
            </li>
            <li>
              Set <strong>Resource owner</strong> to your org. Set{" "}
              <strong>Repository access</strong> to All repositories, or pick
              the repos you watch here. Pick an expiry you're happy with.
            </li>
            <li>
              Under <strong>Repository permissions</strong>, set these to
              Read-only: <code>Commit statuses</code>, <code>Contents</code>,
              and <code>Pull requests</code>. <code>Metadata</code> turns on by
              itself.
            </li>
            <li>
              Under <strong>Organization permissions</strong>, set{" "}
              <code>Members</code> to Read-only. This finds your teams, for
              review requests sent to them.
            </li>
            <li>
              If your org has to approve tokens, wait for an org owner to
              approve it. Syncs fail until then. Changing the permissions later
              may need approval again.
            </li>
            <li>Copy the token and paste it here.</li>
          </ol>
        </div>
      </details>
    </div>
  );
}

function TokenForm({
  onSaved,
  onCancel,
}: {
  onSaved: () => void;
  // Shown while replacing a working token.
  onCancel?: (() => void) | undefined;
}) {
  const [token, setToken] = useState("");
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      api<GitHubTokenResponse>("/github-token", {
        method: "PUT",
        body: { token },
      }),
    onSuccess: async () => {
      setToken("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      onSaved();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <TextField
        label="Personal access token"
        type="password"
        autoComplete="off"
        spellCheck={false}
        required
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      {save.isError && <Alert>{save.error.message}</Alert>}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending ? "Checking token" : "Save token"}
        </Button>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}
