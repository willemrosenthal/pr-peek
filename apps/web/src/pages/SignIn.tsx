import { Bell, CircleCheck, Eye } from "lucide-react";
import { useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { Alert } from "../components/Alert";
import { ButtonLink } from "../components/Button";
import { HelpLinks } from "../components/HelpLinks";
import { useInIosApp } from "../hooks/useIsTray";
import { useMe } from "../queries";
import styles from "./SignIn.module.css";

// Messages for the `?error=` codes the server's GitHub callback sends.
const SIGN_IN_ERRORS: Record<string, string> = {
  denied: "Sign in was canceled on GitHub.",
  state: "Sign in took too long, or started in another tab. Try again.",
  github: "GitHub didn't finish signing you in. Try again.",
  server: "Something went wrong on our side. Try again.",
};

// What Git Buddy does, for people who haven't signed in yet. Colored like the rows.
const FEATURES = [
  {
    Icon: Eye,
    color: "var(--color-kind-review)",
    title: "Reviews you owe, first.",
    text: "Requests, re-requests, and replies to your comments, sorted by how long they've waited.",
  },
  {
    Icon: CircleCheck,
    color: "var(--color-kind-approved)",
    title: "Your own PRs, when they need you.",
    text: "Approved and ready to merge, changes asked for, or checks failing.",
  },
  {
    Icon: Bell,
    color: "var(--color-kind-talk)",
    title: "A push when something lands on you.",
    text: "On your phone, or in the Mac menu bar. Quiet hours hold them back.",
  },
];

export function SignIn() {
  const me = useMe();
  const [params] = useSearchParams();
  const [publicOnly, setPublicOnly] = useState(false);
  // Already the app on this phone.
  const inIosApp = useInIosApp();

  // A failed check keeps the old data, so check it succeeded.
  if (me.isSuccess && !me.data.needsReauth) return <Navigate to="/" replace />;

  const errorCode = params.get("error");
  const error = errorCode
    ? (SIGN_IN_ERRORS[errorCode] ?? SIGN_IN_ERRORS.server)
    : null;

  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <header className={styles.header}>
          <h1 className={styles.title}>Git Buddy</h1>
          <p className={styles.tagline}>
            The pull requests waiting on you, in one list.
          </p>
        </header>

        <ul className={styles.features}>
          {FEATURES.map(({ Icon, color, title, text }) => (
            <li key={title} className={styles.feature}>
              <Icon style={{ color }} aria-hidden="true" />
              <p>
                <strong>{title}</strong>{" "}
                <span className={styles.featureText}>{text}</span>
              </p>
            </li>
          ))}
        </ul>

        {error && <Alert>{error}</Alert>}

        <section className={styles.panel}>
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
            GitHub will ask to let Git Buddy see your repos and teams. GitHub
            has no read-only way to see private repos, so its <code>repo</code>{" "}
            permission also allows changes. Git Buddy only reads. It never
            changes anything on GitHub. Pick "Public repos only" to give it no
            way to change anything, and keep private repos out.
          </p>
          <p className={styles.hint}>
            Git Buddy runs on its own server, in the Mac and iPhone apps too.
            Your GitHub access and the pull requests it finds are kept there,
            encrypted, not only on your device.
          </p>
          {/* Signing in again needs no approval. Waits for `me`, so it doesn't flash. */}
          {!me.isPending && !me.data?.needsReauth && (
            <p className={styles.hint}>
              It's invite only for now: signing in sends a request, and you'll
              get in once it's approved.
            </p>
          )}
          <p className={styles.hint}>
            If your company blocks Git Buddy, ask an org owner to approve it.
            Where your company allows it, you can add a personal access token
            after signing in instead.
          </p>
        </section>

        <HelpLinks install={!inIosApp} />
      </div>
    </main>
  );
}
