import type { ItemGroup, ItemsResponse } from "@pr-peek/core";
import { useMemo } from "react";
import { Link } from "react-router";
import { Alert } from "../components/Alert";
import { Banners } from "../components/Banners";
import { Button } from "../components/Button";
import { ItemSection } from "../components/ItemSection";
import { ListHeader } from "../components/ListHeader";
import { cx } from "../cx";
import { useIsTray } from "../hooks/useIsTray";
import { useMarkSeen } from "../hooks/useMarkSeen";
import { useStoredState } from "../hooks/useStoredState";
import { useSync } from "../hooks/useSync";
import { useItems, useMe, useRepos, useSettings } from "../queries";
import styles from "./ListPage.module.css";

const SECTIONS: { group: ItemGroup; title: string }[] = [
  { group: "review", title: "Needs my review" },
  { group: "replies", title: "Replies to me" },
  { group: "mine", title: "My PRs" },
];

// The sections that can collapse: each group, and Quiet at the bottom.
type SectionKey = ItemGroup | "quiet";

const isSectionList = (value: unknown): value is SectionKey[] =>
  Array.isArray(value) &&
  value.every(
    (key) =>
      key === "quiet" || SECTIONS.some((section) => section.group === key),
  );

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
  const [collapsed, setCollapsed] = useStoredState<SectionKey[]>(
    "pr-peek:collapsed",
    [],
    isSectionList,
  );
  const setOpen = (key: SectionKey, open: boolean) =>
    setCollapsed(
      open ? collapsed.filter((k) => k !== key) : [...collapsed, key],
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
  const showAuthors = useSettings().data?.settings.showAuthors ?? false;

  const { quiet } = groups;
  return (
    <>
      {SECTIONS.map(({ group, title }) => {
        const idle = group === "mine" ? groups.idlePrs : [];
        if (groups[group].length + idle.length === 0) return null;
        return (
          <ItemSection
            key={group}
            title={title}
            items={groups[group]}
            idle={idle}
            showAuthors={showAuthors}
            open={!collapsed.includes(group)}
            onOpenChange={(open) => setOpen(group, open)}
          />
        );
      })}
      {quiet.items.length + quiet.idlePrs.length > 0 && (
        <ItemSection
          title="Quiet"
          items={quiet.items}
          idle={quiet.idlePrs}
          quiet
          open={!collapsed.includes("quiet")}
          onOpenChange={(open) => setOpen("quiet", open)}
        />
      )}
    </>
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
          Pick the repos Git Buddy should watch in{" "}
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
