import type { ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { cx } from "../../cx";
import styles from "./Settings.module.css";

// Paths are relative to /settings.
const SETTINGS_TABS = [
  { path: "general", label: "General" },
  { path: "repos", label: "Repositories" },
  { path: "rules", label: "Rules" },
  { path: "devices", label: "Devices" },
];

// The settings page: a tab list beside the open tab.
export function SettingsLayout() {
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <Link to="/">Back to your list</Link>
          <h1 className={styles.title}>Settings</h1>
        </header>
        <div className={styles.body}>
          <nav className={styles.tabs} aria-label="Settings">
            {SETTINGS_TABS.map(({ path, label }) => (
              <NavLink
                key={path}
                to={path}
                className={({ isActive }) =>
                  cx(styles.tab, isActive && styles.active)
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <section className={styles.content}>
            <Outlet />
          </section>
        </div>
      </div>
    </main>
  );
}

// The open tab's title and a line about it.
export function TabHeading({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.heading}>
      <h2 className={styles.tabTitle}>{title}</h2>
      <p className={styles.hint}>{children}</p>
    </div>
  );
}
