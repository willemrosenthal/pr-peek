import type { UpdateRepoBody, WatchedRepoDto } from "@pr-peek/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { api } from "../api";
import { cx } from "../cx";
import { queryKeys, useReloadWatchList } from "../queries";
import {
  REPO_COLORS,
  watchOf,
  WATCH_CHANGES,
  WATCH_LABELS,
  type Watch,
} from "../repoWatch";
import { ActionRow } from "./ActionRow";
import { Alert } from "./Alert";
import { ColorPicker } from "./ColorPicker";
import { Group } from "./Group";
import { Segmented } from "./Segmented";
import { Sheet } from "./Sheet";
import styles from "./Repos.module.css";

const WATCH_HINTS: Record<Watch, string> = {
  notify: "Shows on your list, and sends notifications.",
  list: "Shows on your list, without notifications.",
  paused: "Git Buddy stops checking it until you pick another.",
};

const WATCH_OPTIONS = (["notify", "list", "paused"] as const).map((value) => ({
  value,
  label: WATCH_LABELS[value],
}));

// The picker's starting color for a repo that never had its own.
const FIRST_COLOR = REPO_COLORS[0]!.value;

// The sheet for one watched repo. It stays on the page while closed, so it slides in
// every time: a sheet that's added already open just appears. Its contents start fresh
// for each repo, so one repo's error never shows on another.
export function RepoSheet({
  repo,
  open,
  onClose,
}: {
  // The last repo opened. It stays while the sheet slides away, even once removed.
  repo: WatchedRepoDto | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        repo && (
          <>
            <span className={styles.owner}>{repo.owner}/</span>
            {repo.name}
          </>
        )
      }
    >
      {repo && <RepoSettings key={repo.id} repo={repo} onRemoved={onClose} />}
    </Sheet>
  );
}

// How Git Buddy watches a repo, its color, and removing it. Shows new values while
// they save.
function RepoSettings({
  repo,
  onRemoved,
}: {
  repo: WatchedRepoDto;
  onRemoved: () => void;
}) {
  const queryClient = useQueryClient();
  const reloadWatchList = useReloadWatchList();
  const update = useMutation({
    mutationFn: (changes: UpdateRepoBody) =>
      api(`/repos/${repo.id}`, { method: "PATCH", body: changes }),
    onSettled: () =>
      Promise.all([
        reloadWatchList(),
        queryClient.invalidateQueries({ queryKey: queryKeys.items }),
      ]),
  });
  const remove = useMutation({
    mutationFn: () => api(`/repos/${repo.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      onRemoved();
      await reloadWatchList();
    },
  });
  const name = `${repo.owner}/${repo.name}`;
  const saving = update.isPending ? update.variables : {};
  const shown: WatchedRepoDto = {
    ...repo,
    enabled: saving.enabled ?? repo.enabled,
    muted: saving.muted ?? repo.muted,
    color: saving.color ?? repo.color,
    colorOn: saving.colorOn ?? repo.colorOn,
  };
  const watch = watchOf(shown);
  const color = shown.colorOn ? shown.color : null;
  const ownColor =
    color && !REPO_COLORS.some((option) => option.value === color)
      ? color
      : null;
  const pickColor = (picked: string | null) =>
    update.mutate(
      picked ? { colorOn: true, color: picked } : { colorOn: false },
    );
  const error = update.error ?? remove.error;
  // Groups the swatches' radio buttons, so arrow keys move between them.
  const swatchGroup = useId();

  return (
    <>
      {error && <Alert>{error.message}</Alert>}
      <Group title="On your list" footer={WATCH_HINTS[watch]} box>
        <div className={styles.sheetBox}>
          <Segmented
            label={`How Git Buddy watches ${name}`}
            value={watch}
            options={WATCH_OPTIONS}
            onChange={(picked) => update.mutate(WATCH_CHANGES[picked])}
            disabled={update.isPending}
          />
        </div>
      </Group>
      <Group
        title="Color"
        footer="Colors the repo's name on your list, so you can spot it."
        box
      >
        <div className={styles.sheetBox}>
          <div
            className={styles.swatches}
            role="radiogroup"
            aria-label={`Color for ${name}`}
          >
            <Swatch
              group={swatchGroup}
              label="No color"
              picked={color === null}
              onPick={() => pickColor(null)}
              className={styles.none}
            />
            {REPO_COLORS.map((option) => (
              <Swatch
                key={option.value}
                group={swatchGroup}
                label={option.label}
                color={option.value}
                picked={color === option.value}
                onPick={() => pickColor(option.value)}
              />
            ))}
            <ColorPicker
              label={`Pick a color for ${name}`}
              color={ownColor ?? shown.color ?? FIRST_COLOR}
              // The rainbow from the class, until it has its own color.
              showColor={ownColor !== null}
              className={cx(
                styles.swatch,
                styles.ownColor,
                ownColor && styles.picked,
              )}
              onChange={pickColor}
            />
          </div>
          <p className={styles.preview}>
            On your list:{" "}
            <span className={styles.previewName}>
              {repo.owner}/
              <strong style={color ? { color } : undefined}>{repo.name}</strong>
            </span>
          </p>
        </div>
      </Group>
      <Group label="Remove">
        <ActionRow
          label="Remove from Git Buddy"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
          danger
        />
      </Group>
    </>
  );
}

// A round color to pick, as a radio button.
function Swatch({
  group,
  label,
  color,
  picked,
  onPick,
  className,
}: {
  // The radio group's name.
  group: string;
  label: string;
  color?: string;
  picked: boolean;
  onPick: () => void;
  className?: string | undefined;
}) {
  return (
    <label
      className={cx(styles.swatch, picked && styles.picked, className)}
      style={color ? { background: color } : undefined}
    >
      <input
        type="radio"
        className="visually-hidden"
        name={group}
        aria-label={label}
        checked={picked}
        onChange={onPick}
      />
    </label>
  );
}
