import { Link } from "react-router";
import { ISSUES_URL } from "../build";
import { inDesktopApp } from "../desktop";
import { ExternalLink } from "./ExternalLink";
import styles from "./HelpLinks.module.css";

// Small links to the privacy page and to feedback, with `install` the install page too.
export function HelpLinks({ install = false }: { install?: boolean }) {
  return (
    <nav className={styles.links} aria-label="Help">
      {/* The Mac app opens it in the browser, where its email link works. */}
      <Link to="/privacy" target={inDesktopApp() ? "_blank" : undefined}>
        How Git Buddy uses your data
      </Link>
      {install && <Link to="/install">Install on your phone or Mac</Link>}
      <ExternalLink href={ISSUES_URL}>
        Report a bug or ask for something
      </ExternalLink>
    </nav>
  );
}
