import { Link } from "react-router";
import { ISSUES_URL } from "../build";
import styles from "./HelpLinks.module.css";

// Small links to the privacy page and to feedback, with `install` the install page too.
export function HelpLinks({ install = false }: { install?: boolean }) {
  return (
    <nav className={styles.links} aria-label="Help">
      <Link to="/privacy">How Git Buddy uses your data</Link>
      {install && <Link to="/install">Install on your phone or Mac</Link>}
      <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
        Report a bug or ask for something
      </a>
    </nav>
  );
}
