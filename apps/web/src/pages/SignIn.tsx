import { useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { Alert } from "../components/Alert";
import { ButtonLink } from "../components/Button";
import { useMe } from "../queries";
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

        {error && <Alert>{error}</Alert>}

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
          <p className={styles.hint}>
            If your company blocks pr-peek, sign in anyway. You can add a
            personal access token after.
          </p>
        </section>
      </div>
    </main>
  );
}
