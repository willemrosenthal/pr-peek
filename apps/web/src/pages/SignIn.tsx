import { Bell, CircleCheck, Eye } from "lucide-react";
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
          <ButtonLink variant="primary" wide href="/api/auth/github">
            Sign in with GitHub
          </ButtonLink>
          <p className={styles.hint}>
            Git Buddy only reads. Signing in lets it see public repos and your
            teams, and nothing it asks for can make changes.
          </p>
          <p className={styles.hint}>
            For private repos, you add a fine-grained token after signing in.
            It's read-only, and reaches only the repos you pick. If your company
            has to approve tokens, ask an org owner.
          </p>
          <p className={styles.hint}>
            Git Buddy runs on its own server, and the Mac and iPhone apps use it
            too. Your GitHub access and the pull requests it finds are kept
            there, encrypted, not on your device.
          </p>
          {/* Signing in again needs no approval. Waits for `me`, so it doesn't flash. */}
          {!me.isPending && !me.data?.needsReauth && (
            <p className={styles.hint}>
              It's invite only for now: signing in sends a request, and you'll
              get in once it's approved.
            </p>
          )}
        </section>

        <HelpLinks install={!inIosApp} />
      </div>
    </main>
  );
}
