import type { ItemGroup, ItemsResponse } from "@pr-peek/core";
import { Link } from "react-router";
import { Alert } from "../components/Alert";
import { Banners } from "../components/Banners";
import { Button } from "../components/Button";
import { ItemSection } from "../components/ItemSection";
import { ListHeader } from "../components/ListHeader";
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

  return (
    <main className={styles.page}>
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
  if (total === 0) return <EmptyList />;
  return <Sections groups={items.data} />;
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

  return SECTIONS.filter(({ group }) => groups[group].length > 0).map(
    ({ group, title }) => (
      <ItemSection
        key={group}
        title={title}
        items={groups[group]}
        open={!collapsed.includes(group)}
        onOpenChange={(open) => setOpen(group, open)}
      />
    ),
  );
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
          <Link to="/settings">settings</Link>.
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
