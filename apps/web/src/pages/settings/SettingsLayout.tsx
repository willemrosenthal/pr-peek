import type { SettingsResponse } from "@pr-peek/core";
import type { ReactNode } from "react";
import { Outlet } from "react-router";
import { Alert } from "../../components/Alert";
import { BackToList } from "../../components/BackToList";
import { useListUpdating } from "../../hooks/useListUpdate";
import { useReturnToList } from "../../hooks/useReturnToList";
import { useSettings } from "../../queries";
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

// The user's settings and rules once they load, with "Loading" until then, or why they
// couldn't load.
export function WithSettings({
  children,
}: {
  children: (data: SettingsResponse) => ReactNode;
}) {
  const settings = useSettings();
  if (settings.isPending) return <p className={styles.hint}>Loading</p>;
  if (settings.isError) return <Alert>{settings.error.message}</Alert>;
  return children(settings.data);
}
