import { PRIVACY_EMAIL, REPO_URL } from "../build";
import { BackToList } from "../components/BackToList";
import { ExternalLink } from "../components/ExternalLink";
import { useReturnToList } from "../hooks/useReturnToList";
import styles from "./InfoPage.module.css";

// Change this whenever the page changes in a way that matters.
const LAST_CHANGED = "10 November 2026";

const Email = () => <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>;

// What Git Buddy keeps, why, and for how long. Open to everyone, so it can be read
// before signing in. Keep it in step with what the server stores (schema.prisma).
export function PrivacyPage() {
  useReturnToList();
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <BackToList />
          <h1 className={styles.title}>Privacy</h1>
          <p className={styles.hint}>Last changed {LAST_CHANGED}.</p>
        </header>

        <p>
          Git Buddy shows the GitHub pull requests waiting on you. This page
          says what it keeps about you, why, and for how long. Questions? Write
          to <Email />.
        </p>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Who runs it</h2>
          <p>
            Git Buddy is a free app, run by one person. Its code is open on{" "}
            <ExternalLink href={REPO_URL}>GitHub</ExternalLink>. Write to{" "}
            <Email /> about anything on this page.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>What it keeps</h2>
          <ul className={styles.list}>
            <li>Your GitHub profile: username, name, picture, and id.</li>
            <li>
              Your GitHub sign-in token, and any personal access tokens you add.
              All encrypted.
            </li>
            <li>
              For the repos you watch: pull request titles, links, authors, and
              states, with short notes like "sam asked for your review".
              Comments aren't stored. A preview loads them from GitHub when you
              open it.
            </li>
            <li>
              Your settings: time zone, quiet hours, rules, and the repos you
              watch.
            </li>
            <li>
              For notifications: the address each browser or Mac gives Git Buddy
              to send them to, and the device's name.
            </li>
            <li>
              One cookie, to keep you signed in. No ads, no tracking cookies,
              and no analytics.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Why</h2>
          <p>
            Only to run Git Buddy for you: to find the pull requests that need
            you, show them, and notify you. It's never sold, shared for ads, or
            used for anything else.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Your GitHub access</h2>
          <ul className={styles.list}>
            <li>
              Git Buddy runs on its own server, and the Mac and iPhone apps use
              it too. Your GitHub access is kept and used there, encrypted, not
              on your device.
            </li>
            <li>
              Signing in asks GitHub for <code>repo</code> and{" "}
              <code>read:org</code>. GitHub has no read-only way to see private
              repos, so <code>repo</code> also allows changes. Git Buddy only
              reads. It never changes anything on GitHub. "Public repos only"
              asks for just <code>read:org</code>, which can't change anything.
            </li>
            <li>
              A personal access token can do whatever you allowed when you made
              it. A classic token with full <code>repo</code> access can do
              anything you can do in your repos. Git Buddy still only reads with
              it. A fine-grained token is safer: give it read-only access, only
              the repos you watch, and a short expiry.
            </li>
            <li>
              To take Git Buddy's access away, revoke it in GitHub's{" "}
              <ExternalLink href="https://github.com/settings/applications">
                Authorized OAuth Apps
              </ExternalLink>
              . Delete tokens you made in GitHub's{" "}
              <ExternalLink href="https://github.com/settings/tokens">
                personal access tokens
              </ExternalLink>
              .
            </li>
            <li>
              Adding a token doesn't shrink what you allowed when you signed in.
              To give Git Buddy less, revoke it in Authorized OAuth Apps, then
              sign in again with "Public repos only". A fine-grained token can
              then add just the private repos you need.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>How long it's kept</h2>
          <ul className={styles.list}>
            <li>
              Your profile, tokens, and settings: while you have an account.
            </li>
            <li>
              Things that needed you and are done: 30 days. Pull requests that
              leave your list: about 7 days, unless you flagged them.
            </li>
            <li>
              Being signed in: ends after 30 days without using Git Buddy.
            </li>
            <li>
              Server logs, with IP addresses and the pages asked for, but never
              tokens or cookies: a few weeks at most.
            </li>
            <li>Database backups: 7 days.</li>
            <li>Error reports in Sentry: 30 days.</li>
            <li>
              Delete my account, in Settings, deletes it all right away, signs
              you out everywhere, and gives up Git Buddy's GitHub access. After
              7 days it's gone from the backups too.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Who else handles it</h2>
          <ul className={styles.list}>
            <li>Supabase keeps the database, in Ohio, USA.</li>
            <li>Render runs the app, in Ohio, USA.</li>
            <li>GitHub, where it all comes from.</li>
            <li>
              Sentry, in the USA, gets a report when something breaks: the
              error, where in the code it happened, and the page or request. It
              also times a share of requests, to find slow ones. Never tokens,
              cookies, or what a request sent.
            </li>
            <li>
              Apple, Google, Mozilla, and Microsoft deliver notifications to
              their browsers. Each notification is encrypted, so they can't read
              it.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Your rights</h2>
          <ul className={styles.list}>
            <li>
              A copy of what Git Buddy has about you: write to <Email />.
            </li>
            <li>
              Fixing it: almost all of it comes from GitHub. Change it there,
              and Git Buddy picks it up.
            </li>
            <li>Deleting it: Delete my account, in Settings.</li>
            <li>
              In the EU or UK, you can also complain to your data protection
              authority.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
