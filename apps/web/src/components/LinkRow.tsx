import { ChevronRight, ExternalLink, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { cx } from "../cx";
import styles from "./LinkRow.module.css";

export type Tone = "warning" | "danger";

type Target =
  // A page of the app. `newTab` opens it in a new tab (in the Mac app, the browser).
  | { to: string; newTab?: boolean }
  // Another site, opened in a new tab.
  | { href: string }
  // Something on this page, like a sheet.
  | { onClick: () => void };

// A row of a Group that opens something: a page, another site, or with `onClick`
// something here, like a sheet. An icon on a colored tile, a name, a line on how it's
// set, and an arrow.
export function LinkRow({
  icon: Icon,
  color,
  start,
  label,
  status,
  tone,
  ...target
}: {
  icon?: LucideIcon;
  // The tile's color, like "var(--color-kind-review)".
  color?: string;
  // Something else before the name, in place of an icon, like a color dot.
  start?: ReactNode;
  label: ReactNode;
  status?: ReactNode;
  tone?: Tone | undefined;
} & Target) {
  const content = (
    <>
      {Icon && (
        <span className={styles.tile} style={{ background: color }}>
          <Icon size={18} strokeWidth={2} aria-hidden="true" />
        </span>
      )}
      {start}
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {status && (
          <>
            {/* So screen readers pause between the name and the status. */}
            <span className="visually-hidden">,</span>{" "}
            <span className={cx(styles.status, tone && styles[tone])}>
              {status}
            </span>
          </>
        )}
      </span>
      {"href" in target ? (
        <ExternalLink className={styles.arrow} size={16} aria-hidden="true" />
      ) : (
        <ChevronRight className={styles.arrow} size={18} aria-hidden="true" />
      )}
    </>
  );
  return (
    <li className={styles.item}>
      {"onClick" in target ? (
        <button
          type="button"
          className={cx(styles.link, styles.button)}
          onClick={target.onClick}
        >
          {content}
        </button>
      ) : "href" in target ? (
        <a
          className={styles.link}
          href={target.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {content}
        </a>
      ) : (
        <Link
          className={styles.link}
          to={target.to}
          target={target.newTab ? "_blank" : undefined}
        >
          {content}
        </Link>
      )}
    </li>
  );
}
