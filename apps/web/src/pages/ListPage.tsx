import type {
  ItemDto,
  ItemsResponse,
  ListSection,
  ShowAuthors,
} from "@pr-peek/core";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AddPrDialog } from "../components/AddPrDialog";
import { Toast, type ToastMessage } from "../components/Toast";
import { Banners } from "../components/Banners";
import { NotificationPrompt } from "../components/NotificationPrompt";
import { Button } from "../components/Button";
import { ItemSection } from "../components/ItemSection";
import { ListHeader } from "../components/ListHeader";
import {
  PrPreview,
  type OnPreview,
  type PreviewTarget,
} from "../components/PrPreview";
import { PullToRefresh } from "../components/PullToRefresh";
import { cx } from "../cx";
import { useIsTray } from "../hooks/useIsTray";
import { useMarkSeen } from "../hooks/useMarkSeen";
import { useQuickAdd } from "../hooks/useQuickAdd";
import { useStoredState } from "../hooks/useStoredState";
import { useSync } from "../hooks/useSync";
import { useWhenHidden } from "../hooks/useWhenHidden";
import { isStandalone } from "../install";
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
const showsAuthors = (setting: ShowAuthors, group: ListSection) =>
  setting === "all" || (setting === "review" && group === "review");

// A section's items. Watching has none: only PRs with nothing to do go there.
const itemsIn = (groups: ItemsResponse, group: ListSection): ItemDto[] =>
  group === "watching" ? [] : groups[group];

// The sections that can collapse: each group, and Quiet at the bottom.
type SectionKey = ListSection | "quiet";

const isSectionList = (value: unknown): value is SectionKey[] =>
  Array.isArray(value) &&
  value.every(
    (key) =>
      key === "quiet" || SECTIONS.some((section) => section.group === key),
  );

export function ListPage() {
  const me = useMe();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const endToast = useCallback(() => setToast(null), []);
  // Like "Wait a moment and try again" after refreshing too often.
  const sync = useSync({ onError: (err) => setToast({ text: err.message }) });
  const tray = useIsTray();
  const setQuiet = useSetQuiet();
  const toggleImportant = useToggleImportant();
  // The PR whose preview is open. Kept here, not in its section, so the sheet stays
  // through its closing slide even when the section goes away.
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [adding, setAdding] = useAddLink();
  // Both close when the app hides, so it opens on the plain list, like other pages.
  useWhenHidden(
    useCallback(() => {
      setPreview(null);
      setAdding(null);
    }, [setAdding]),
  );
  // A PR just added, to scroll to once the list shows it.
  const [added, setAdded] = useState<string | null>(null);
  const onShown = useCallback(() => setAdded(null), []);
  // Paste or drop a PR link on the list to add it.
  const { dragging, dropTarget } = useQuickAdd({
    enabled: preview === null && adding === null,
    onAdded: setAdded,
    onToast: setToast,
  });

  return (
    <main
      className={cx(
        styles.page,
        tray && styles.tray,
        dragging && styles.dropping,
      )}
      {...dropTarget}
    >
      {dragging && (
        <p className={styles.dropHint} aria-hidden="true">
          Drop to add
        </p>
      )}
      <PullToRefresh
        className={styles.panel}
        refreshing={sync.refreshing}
        onRefresh={sync.refresh}
        enabled={preview === null && adding === null}
      >
        <div className={styles.top}>
          <ListHeader
            lastSyncedAt={sync.status?.lastSyncedAt}
            refreshing={sync.refreshing}
            onRefresh={sync.refresh}
          />
          <Banners me={me.data} syncError={sync.status?.syncError} />
          {!tray && isStandalone() && <NotificationPrompt />}
        </div>
        <ListBody
          onPreview={setPreview}
          onAdd={() => setAdding("")}
          added={added}
          onShown={onShown}
        />
      </PullToRefresh>
      <AddPrDialog
        link={adding}
        onClose={() => setAdding(null)}
        onAdded={(prId) => {
          setAdding(null);
          setAdded(prId);
        }}
      />
      <Toast toast={toast} onDone={endToast} />
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

// The add dialog's link: null when closed. Kept in the address as `?add=`, so a share
// can open it (SharePage).
function useAddLink() {
  const [params, setParams] = useSearchParams();
  const setLink = useCallback(
    (link: string | null) =>
      setParams(
        (current) => {
          if (link === null) current.delete("add");
          else current.set("add", link);
          return current;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [params.get("add"), setLink] as const;
}

// Scrolls to the row of the PR `prId` once the list shows it, with a short highlight.
// Not found while its section is closed.
function useShowRow(
  prId: string | null,
  list: ItemsResponse | undefined,
  onShown: () => void,
) {
  useEffect(() => {
    if (!prId || !list) return;
    const row = document.querySelector<HTMLElement>(`[data-pr-id="${prId}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.dataset.flash = "";
    row.addEventListener("animationend", () => delete row.dataset.flash, {
      once: true,
    });
    onShown();
  }, [prId, list, onShown]);
}

function ListBody({
  onPreview,
  onAdd,
  added,
  onShown,
}: {
  onPreview: OnPreview;
  onAdd: () => void;
  added: string | null;
  onShown: () => void;
}) {
  const items = useItems();
  useShowRow(added, items.data, onShown);

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
    (sum, { group }) => sum + itemsIn(items.data, group).length,
    0,
  );
  return (
    <>
      {total === 0 && <EmptyList />}
      <Sections groups={items.data} onPreview={onPreview} />
      <button type="button" className={styles.addRow} onClick={onAdd}>
        <Plus aria-hidden="true" />
        Add a PR by link
      </button>
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
        .flatMap(({ group }) => itemsIn(groups, group))
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
        const items = itemsIn(groups, group);
        const idle = groups.idlePrs.filter((pr) => pr.group === group);
        const merged = groups.merged.filter((pr) => pr.group === group);
        if (items.length + idle.length + merged.length === 0) return null;
        return (
          <ItemSection
            key={group}
            title={title}
            items={items}
            watching={group === "watching"}
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
