import type { ItemGroup, ItemsResponse, ShowAuthors } from "@pr-peek/core";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import { Alert } from "../components/Alert";
import { Banners } from "../components/Banners";
import { Button } from "../components/Button";
import { ItemSection } from "../components/ItemSection";
import { ListHeader } from "../components/ListHeader";
import {
  PrPreview,
  type OnPreview,
  type PreviewTarget,
} from "../components/PrPreview";
import {
  PullToRefreshSpinner,
  usePullToRefresh,
} from "../components/PullToRefresh";
import { cx } from "../cx";
import { useIsTray } from "../hooks/useIsTray";
import { useMarkSeen } from "../hooks/useMarkSeen";
import { useStoredState } from "../hooks/useStoredState";
import { useSync } from "../hooks/useSync";
import { useWhenHidden } from "../hooks/useWhenHidden";
import { useLocalSetting } from "../localSetting";
import {
  useItems,
  useMe,
  useRepos,
  useSetQuiet,
  useSettings,
  useToggleImportant,
} from "../queries";
import { orderSections, SECTIONS, sectionOrder } from "../sections";
import styles from "./ListPage.module.css";

// Whether a section's rows show their authors' pictures.
const showsAuthors = (setting: ShowAuthors, group: ItemGroup) =>
  setting === "all" || (setting === "review" && group === "review");

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
  const setQuiet = useSetQuiet();
  const toggleImportant = useToggleImportant();
  // The PR whose preview is open. Kept here, not in its section, so the sheet stays
  // through its closing slide even when the section goes away.
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  // Closes when the app hides, so it opens on the plain list, like other pages.
  useWhenHidden(useCallback(() => setPreview(null), []));
  const pull = usePullToRefresh({
    refreshing: sync.refreshing,
    onRefresh: sync.refresh,
    enabled: preview === null,
  });

  return (
    <main className={cx(styles.page, tray && styles.tray)}>
      <PullToRefreshSpinner offset={pull.offset} dragging={pull.dragging} />
      <div
        className={cx(styles.panel, pull.page.className)}
        style={pull.page.style}
      >
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
        <ListBody onPreview={setPreview} />
      </div>
      <PrPreview
        target={preview}
        // The row moves, like after a swipe, so the sheet closes.
        onToggleQuiet={() => {
          if (preview) {
            setQuiet.mutate({ prId: preview.pr.id, quiet: !preview.quiet });
          }
          setPreview(null);
        }}
        // Closes too, since it's a reminder for later.
        onToggleImportant={() => {
          if (preview) toggleImportant(preview.pr);
          setPreview(null);
        }}
        onClose={() => setPreview(null)}
      />
    </main>
  );
}

function ListBody({ onPreview }: { onPreview: OnPreview }) {
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
      <Sections groups={items.data} onPreview={onPreview} />
    </>
  );
}

function Sections({
  groups,
  onPreview,
}: {
  groups: ItemsResponse;
  onPreview: OnPreview;
}) {
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
  const showAuthors = useSettings().data?.settings.showAuthors ?? "off";
  const sections = orderSections(useLocalSetting(sectionOrder));

  const { quiet } = groups;
  return (
    <>
      {sections.map(({ group, title }) => {
        const idle = groups.idlePrs.filter((pr) => pr.group === group);
        const merged = groups.merged.filter((pr) => pr.group === group);
        if (groups[group].length + idle.length + merged.length === 0) {
          return null;
        }
        return (
          <ItemSection
            key={group}
            title={title}
            items={groups[group]}
            idle={idle}
            merged={merged}
            showAuthors={showsAuthors(showAuthors, group)}
            open={!collapsed.includes(group)}
            onOpenChange={(open) => setOpen(group, open)}
            onPreview={onPreview}
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
          onPreview={onPreview}
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
