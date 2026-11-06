import { Select } from "@base-ui/react/select";
import type { RepoOwner, RepoOwnerKind } from "@pr-peek/core";
import { Check, ChevronDown, Search, Star, User } from "lucide-react";
import { useState } from "react";
import { cx } from "../cx";
import { avatarUrl } from "./ItemRow";
import styles from "./OwnerSelect.module.css";
import { Spinner } from "./Spinner";

// The menu's choices that aren't a GitHub name. No GitHub name starts with "*".
export const ALL = "*all";
export const OTHER = "*other";

const GROUPS: { kind: RepoOwnerKind; label: string }[] = [
  { kind: "you", label: "You" },
  { kind: "org", label: "Your orgs" },
  { kind: "shared", label: "Shared with you" },
];

// Picks whose repos to list: all the user's, one owner's, or any name typed in Other.
export function OwnerSelect({
  value,
  onChange,
  owners,
  count,
  loadingMore,
}: {
  value: string;
  onChange: (value: string) => void;
  // Undefined until the menu loads.
  owners: RepoOwner[] | undefined;
  // The owner's repo count, once their list loads.
  count: number | undefined;
  loadingMore: boolean;
}) {
  // The remembered owner, until the menu loads.
  const listed =
    owners ??
    (value === ALL || value === OTHER ? [] : [{ login: value, kind: "you" }]);
  const items = [
    { value: ALL, label: "All my repos" },
    ...listed.map(({ login }) => ({ value: login, label: login })),
    { value: OTHER, label: "Other…" },
  ];
  const kind = listed.find((owner) => owner.login === value)?.kind;

  return (
    <Select.Root
      items={items}
      value={value}
      onValueChange={(next) => next !== null && onChange(next)}
    >
      <div className={styles.field}>
        <Select.Label className={styles.label}>Add a repo from</Select.Label>
        <Select.Trigger className={styles.trigger}>
          {/* Keyed, so a picture that failed doesn't stay failed for the next owner. */}
          <OwnerIcon key={value} value={value} kind={kind} />
          <Select.Value className={styles.value} />
          {loadingMore && <Spinner />}
          {count !== undefined && (
            <span className={styles.count}>
              {count.toLocaleString("en-US")} {count === 1 ? "repo" : "repos"}
            </span>
          )}
          <Select.Icon className={styles.caret}>
            <ChevronDown size={16} />
          </Select.Icon>
        </Select.Trigger>
      </div>
      <Select.Portal>
        <Select.Positioner
          className={styles.positioner}
          sideOffset={6}
          alignItemWithTrigger={false}
        >
          <Select.Popup className={styles.popup}>
            <Select.List className={styles.list}>
              <OwnerItem value={ALL} label="All my repos" />
              {GROUPS.map(({ kind, label }) => (
                <OwnerGroup
                  key={kind}
                  label={label}
                  owners={listed.filter((owner) => owner.kind === kind)}
                />
              ))}
              <Select.Separator className={styles.separator} />
              <OwnerItem value={OTHER} label="Other…" />
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function OwnerGroup({ label, owners }: { label: string; owners: RepoOwner[] }) {
  if (owners.length === 0) return null;
  return (
    <Select.Group className={styles.group}>
      <Select.GroupLabel className={styles.groupLabel}>
        {label}
      </Select.GroupLabel>
      {owners.map(({ login, kind }) => (
        <OwnerItem key={login} value={login} label={login} kind={kind} />
      ))}
    </Select.Group>
  );
}

function OwnerItem({
  value,
  label,
  kind,
}: {
  value: string;
  label: string;
  kind?: RepoOwnerKind | undefined;
}) {
  return (
    <Select.Item className={styles.item} value={value}>
      <OwnerIcon value={value} kind={kind} />
      <Select.ItemText className={styles.itemText}>{label}</Select.ItemText>
      <Select.ItemIndicator className={styles.check}>
        <Check size={16} />
      </Select.ItemIndicator>
    </Select.Item>
  );
}

// A star for all repos, a search for Other, or the owner's GitHub picture. Orgs get
// square corners, like on GitHub.
function OwnerIcon({
  value,
  kind,
}: {
  value: string;
  kind: RepoOwnerKind | undefined;
}) {
  const [failed, setFailed] = useState(false);
  const Icon =
    value === ALL ? Star : value === OTHER ? Search : failed ? User : null;
  if (Icon) {
    return (
      <span className={styles.tile}>
        <Icon size={14} fill={Icon === Star ? "currentColor" : "none"} />
      </span>
    );
  }
  return (
    <img
      className={cx(styles.avatar, kind === "org" && styles.square)}
      src={avatarUrl(value)}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}
