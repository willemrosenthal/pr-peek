import type { ItemDto, ItemKind, StaleLevel } from "@pr-peek/core";
import { cx } from "../cx";
import { Icon, type IconName } from "./Icon";
import styles from "./ItemRow.module.css";

const KIND_ICONS: Record<
  ItemKind,
  { icon: IconName; tone: string | undefined }
> = {
  review_requested: { icon: "eye", tone: styles.accent },
  re_requested: { icon: "again", tone: styles.accent },
  reply: { icon: "reply", tone: styles.reply },
  mention: { icon: "mention", tone: styles.reply },
  reviewed: { icon: "reviewed", tone: styles.success },
  commented: { icon: "comment", tone: styles.muted },
  check_failed: { icon: "failed", tone: styles.danger },
};

const AGE_TONES: Record<StaleLevel, string | undefined> = {
  fresh: styles.muted,
  warn: styles.warning,
  late: styles.danger,
};

// One item, as two lines: what PR and how long, then what happened and where.
export function ItemRow({ item }: { item: ItemDto }) {
  const { icon, tone } = KIND_ICONS[item.kind];
  // Only review requests have a stale level.
  const ageTone = item.staleLevel ? AGE_TONES[item.staleLevel] : styles.muted;

  return (
    <a
      className={cx(styles.row, item.unseen && styles.unseen)}
      href={item.pr.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className={cx(styles.icon, tone)}>
        <Icon name={icon} />
      </span>
      <span className={styles.title}>
        {item.unseen && <span className="visually-hidden">New: </span>}
        {item.pr.title}
      </span>
      <span className={cx(styles.age, ageTone)}>{item.age}</span>
      <span className={styles.summary}>
        <span className={styles.summaryText}>{item.summary}</span>
        {item.otherIds.length > 0 && (
          <span className={styles.more}>+{item.otherIds.length} more</span>
        )}
      </span>
      <span className={styles.repo}>
        {item.pr.repo} #{item.pr.number}
      </span>
    </a>
  );
}
