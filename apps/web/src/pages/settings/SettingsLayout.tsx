import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import { BackToList } from "../../components/BackToList";
import { cx } from "../../cx";
import { useListUpdating } from "../../hooks/useListUpdate";
import { useReturnToList } from "../../hooks/useReturnToList";
import { useMe } from "../../queries";
import styles from "./Settings.module.css";

// Paths are relative to /settings.
const SETTINGS_TABS = [
  { path: "general", label: "General" },
  { path: "repos", label: "Repos" },
  { path: "rules", label: "Rules" },
  { path: "timing", label: "Timing" },
];
// Only admins see it.
const ADMIN_TAB = { path: "admin", label: "Admin" };

// The settings page: a tab bar above the open tab.
export function SettingsLayout() {
  useReturnToList();
  const updating = useListUpdating();
  const tabs = useMe().data?.isAdmin
    ? [...SETTINGS_TABS, ADMIN_TAB]
    : SETTINGS_TABS;
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <BackToList />
          <h1 className={styles.title}>Settings</h1>
          <p role="status" className={styles.updating}>
            {updating && "Updating your list…"}
          </p>
        </header>
        <div className={styles.body}>
          <nav className={styles.tabs} aria-label="Settings">
            {tabs.map(({ path, label }) => (
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
