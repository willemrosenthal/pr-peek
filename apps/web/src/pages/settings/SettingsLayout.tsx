import type { ReactNode } from "react";
import { Outlet } from "react-router";
import { BackToList } from "../../components/BackToList";
import { useListUpdating } from "../../hooks/useListUpdate";
import { useReturnToList } from "../../hooks/useReturnToList";
import styles from "./Settings.module.css";

// Holds every settings page: the home screen and the page each of its rows opens.
export function SettingsLayout() {
  useReturnToList();
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <Outlet />
      </div>
    </main>
  );
}

// One settings page: a header with the back arrow and the page's name, then its groups.
// `back` is where the arrow goes: the settings home screen, unless set.
export function SettingsPage({
  title,
  back = "/settings",
  action,
  children,
}: {
  title: string;
  back?: string;
  // A button on the header's right, like Add.
  action?: ReactNode;
  children: ReactNode;
}) {
  const updating = useListUpdating();
  return (
    <>
      <header className={styles.header}>
        {back === "/" ? (
          <BackToList />
        ) : (
          <BackToList to={back} label="Back to Settings" />
        )}
        <h1 className={styles.title}>{title}</h1>
        <p role="status" className={styles.updating}>
          {updating && "Updating your list…"}
        </p>
        {action}
      </header>
      <div className={styles.body}>{children}</div>
    </>
  );
}
