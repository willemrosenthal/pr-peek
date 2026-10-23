import type { ItemGroup, ItemsResponse } from "@pr-peek/core";
import { useMemo } from "react";
import { Link } from "react-router";
import { Alert } from "../components/Alert";
import { Banners } from "../components/Banners";
import { Button } from "../components/Button";
import { ItemSection } from "../components/ItemSection";
import { ListHeader } from "../components/ListHeader";
import { cx } from "../cx";
import { inDesktopApp, quitApp } from "../desktop";
import { useIsTray } from "../hooks/useIsTray";
import { useMarkSeen } from "../hooks/useMarkSeen";
import { useStoredState } from "../hooks/useStoredState";
import { useSync } from "../hooks/useSync";
import { useItems, useMe, useRepos } from "../queries";
import styles from "./ListPage.module.css";

const SECTIONS: { group: ItemGroup; title: string }[] = [
  { group: "review", title: "Needs my review" },
  { group: "replies", title: "Replies to me" },
  { group: "mine", title: "My PRs" },
];

const isGroupList = (value: unknown): value is ItemGroup[] =>
  Array.isArray(value) &&
  value.every((group) => SECTIONS.some((section) => section.group === group));

export function ListPage() {
  const me = useMe();
  const sync = useSync();
  const tray = useIsTray();

  return (
    <main className={cx(styles.page, tray && styles.tray)}>
      <div className={styles.panel}>
        <div className={styles.top}>
          <ListHeader
            lastSyncedAt={sync.status?.lastSyncedAt}
            refreshing={sync.refreshing}
            onRefresh={sync.refresh}
          />
          <Banners me={me.data} syncError={sync.status?.syncError} />
          {sync.refreshError && (
            <div className={styles.message}>
              <Alert>{sync.refreshError.message}</Alert>
            </div>
          )}
        </div>
        <ListBody />
        {tray && (
          <footer className={styles.footer}>
            {/* The menu bar app opens this in the default browser. */}
            <a href="/" target="_blank" rel="noopener noreferrer">
              Open in browser
            </a>
            {inDesktopApp() && (
              <button type="button" className={styles.quit} onClick={quitApp}>
                Quit pr-peek
              </button>
            )}
          </footer>
        )}
      </div>
    </main>
  );
}

function ListBody() {
  const items = useItems();

  if (items.isPending) return <p className={styles.message}>Loading</p>;
  if (items.isError) {
    return (
      <div className={styles.message}>
        <p>Couldn't load your list. {items.error.message}</p>
        <Button onClick={() => void items.refetch()}>Try again</Button>
      </div>
    );
  }
  const total = SECTIONS.reduce(
    (sum, { group }) => sum + items.data[group].length,
    0,
  );
  return (
    <>
      {total === 0 && <EmptyList />}
      <Sections groups={items.data} />
    </>
  );
}

function Sections({ groups }: { groups: ItemsResponse }) {
  const [collapsed, setCollapsed] = useStoredState<ItemGroup[]>(
    "pr-peek:collapsed",
    [],
    isGroupList,
  );
  const setOpen = (group: ItemGroup, open: boolean) =>
    setCollapsed(
      open ? collapsed.filter((g) => g !== group) : [...collapsed, group],
    );

  const unseenIds = useMemo(
    () =>
      SECTIONS.filter(({ group }) => !collapsed.includes(group))
        .flatMap(({ group }) => groups[group])
        .filter((item) => item.unseen)
        // A row stands for every open item on its PR.
        .flatMap((item) => [item.id, ...item.otherIds]),
    [groups, collapsed],
  );
  useMarkSeen(unseenIds);

  return SECTIONS.map(({ group, title }) => {
    const idle = group === "mine" ? groups.idlePrs : [];
    if (groups[group].length + idle.length === 0) return null;
    return (
      <ItemSection
        key={group}
        title={title}
        items={groups[group]}
        idle={idle}
        open={!collapsed.includes(group)}
        onOpenChange={(open) => setOpen(group, open)}
      />
    );
  });
}

function EmptyList() {
  const repos = useRepos();
  if (repos.isPending) return null;
  if (repos.data?.repos.length === 0) {
    return (
      <div className={styles.message}>
        <p className={styles.emptyTitle}>You're not watching any repos yet</p>
        <p>
          Pick the repos pr-peek should watch in{" "}
          <Link to="/settings/repos">settings</Link>.
        </p>
      </div>
    );
  }
  return (
    <div className={styles.message}>
      <p className={styles.emptyTitle}>Nothing needs you right now</p>
      <p>New review requests, replies, and checks on your PRs show up here.</p>
    </div>
  );
}
