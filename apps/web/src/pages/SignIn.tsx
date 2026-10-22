import type { TokenSignInResponse } from "@pr-peek/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { api } from "../api";
import { Button, ButtonLink } from "../components/Button";
import { queryKeys, useMe } from "../queries";
import styles from "./SignIn.module.css";

// Messages for the `?error=` codes the server's GitHub callback sends.
const SIGN_IN_ERRORS: Record<string, string> = {
  denied: "Sign in was canceled on GitHub.",
  state: "Sign in took too long, or started in another tab. Try again.",
  github: "GitHub didn't finish signing you in. Try again.",
  server: "Something went wrong on our side. Try again.",
};

export function SignIn() {
  const me = useMe();
  const [params] = useSearchParams();
  const [publicOnly, setPublicOnly] = useState(false);
  const [useToken, setUseToken] = useState(false);

  // A pasted token stopped working, so ask for a new one.
  const tokenExpired =
    me.data?.needsReauth === true && me.data.user.authMethod === "pat";
  if (me.data && !me.data.needsReauth) return <Navigate to="/" replace />;

  const errorCode = params.get("error");
  const error = errorCode
    ? (SIGN_IN_ERRORS[errorCode] ?? SIGN_IN_ERRORS.server)
    : null;

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <h1 className={styles.title}>pr-peek</h1>
          <p className={styles.tagline}>
            The pull requests waiting on you, in one list.
          </p>
        </header>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {tokenExpired ? (
          <section className={styles.section}>
            <h2 className={styles.heading}>Your token stopped working</h2>
            <p className={styles.hint}>
              It may have expired. Paste a new one to keep going.
            </p>
            <TokenForm />
          </section>
        ) : (
          <>
            <section className={styles.section}>
              <ButtonLink
                variant="primary"
                wide
                href={`/api/auth/github${publicOnly ? "?scope=public" : ""}`}
              >
                Sign in with GitHub
              </ButtonLink>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={publicOnly}
                  onChange={(e) => setPublicOnly(e.target.checked)}
                />
                Public repos only
              </label>
              <p className={styles.hint}>
                GitHub will ask to let pr-peek see your repos, teams, and
                notifications. pr-peek only reads. It never changes anything on
                GitHub. Pick "Public repos only" to keep private repos out.
              </p>
            </section>

            <section className={styles.section}>
              {useToken ? (
                <>
                  <h2 className={styles.heading}>Use a token instead</h2>
                  <TokenSteps />
                  <TokenForm />
                </>
              ) : (
                <Button wide onClick={() => setUseToken(true)}>
                  Use a token instead
                </Button>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

// For orgs that block our GitHub app.
function TokenSteps() {
  return (
    <ol className={styles.steps}>
      <li>
        On GitHub, go to Settings, Developer settings, Personal access tokens,{" "}
        <strong>Tokens (classic)</strong>, then Generate new token (classic).
      </li>
      <li>
        Tick the <code>repo</code> and <code>read:org</code> scopes. Pick an
        expiry you're happy with. You'll paste a new token when it runs out.
      </li>
      <li>
        If your company uses single sign-on, click{" "}
        <strong>Configure SSO</strong>, then <strong>Authorize</strong> next to
        your org. Without this, work repos won't show up.
      </li>
      <li>Copy the token and paste it here.</li>
    </ol>
  );
}

function TokenForm() {
  const [token, setToken] = useState("");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signIn = useMutation({
    mutationFn: () =>
      api<TokenSignInResponse>("/auth/token", {
        method: "POST",
        body: { token },
      }),
    onSuccess: async ({ isNew }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      await navigate(isNew ? "/onboarding" : "/", { replace: true });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    signIn.mutate();
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <label className={styles.field}>
        <span>Personal access token</span>
        <input
          className={styles.input}
          type="password"
          autoComplete="off"
          spellCheck={false}
          required
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      {signIn.isError && (
        <p className={styles.error} role="alert">
          {signIn.error.message}
        </p>
      )}
      <Button type="submit" variant="primary" wide disabled={signIn.isPending}>
        {signIn.isPending ? "Checking token" : "Sign in with token"}
      </Button>
    </form>
  );
}
