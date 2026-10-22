import type { ItemDto, ItemKind, StaleLevel } from "@pr-peek/core";
import {
  AtSign,
  CircleCheck,
  CircleX,
  Eye,
  MessageCircle,
  MessageSquareText,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { cx } from "../cx";
import styles from "./ItemRow.module.css";

const KIND_ICONS: Record<
  ItemKind,
  { Icon: LucideIcon; tone: string | undefined }
> = {
  review_requested: { Icon: Eye, tone: styles.accent },
  re_requested: { Icon: RefreshCw, tone: styles.accent },
  reply: { Icon: MessageCircle, tone: styles.reply },
  mention: { Icon: AtSign, tone: styles.reply },
  reviewed: { Icon: CircleCheck, tone: styles.success },
  commented: { Icon: MessageSquareText, tone: styles.muted },
  check_failed: { Icon: CircleX, tone: styles.danger },
};

const AGE_TONES: Record<StaleLevel, string | undefined> = {
  fresh: styles.muted,
  warn: styles.warning,
  late: styles.danger,
};

// One item, as two lines: what PR and how long, then what happened and where.
export function ItemRow({ item }: { item: ItemDto }) {
  const { Icon, tone } = KIND_ICONS[item.kind];
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
        <Icon />
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
