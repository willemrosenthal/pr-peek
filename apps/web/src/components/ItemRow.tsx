import type { IdlePrDto, ItemDto, ItemKind, StaleLevel } from "@pr-peek/core";
import {
  AtSign,
  BotMessageSquare,
  CircleCheck,
  CircleX,
  Eye,
  MessageCircle,
  MessageSquareText,
  RefreshCw,
  Squircle,
  SquircleDashed,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
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
  const { Icon: KindIcon, tone } = KIND_ICONS[item.kind];
  const botComment = item.actorIsBot && item.kind === "commented";
  return (
    <Row
      pr={item.pr}
      className={item.unseen && styles.unseen}
      // Keeps the kind's color, so a bot's approval still reads as an approval.
      // Bot comments get their own color.
      Icon={item.actorIsBot ? BotMessageSquare : KindIcon}
      tone={botComment ? styles.bot : tone}
      title={
        <>
          {item.unseen && <span className="visually-hidden">New: </span>}
          {item.pr.title}
        </>
      }
      age={item.age}
      // Only review requests have a stale level.
      ageTone={item.staleLevel ? AGE_TONES[item.staleLevel] : styles.muted}
    >
      <span className={styles.summaryText}>{item.summary}</span>
      {item.otherIds.length > 0 && (
        <span className={styles.more}>+{item.otherIds.length} more</span>
      )}
    </Row>
  );
}

// One of the user's PRs with nothing to do. Drafts are dimmed.
export function IdlePrRow({ pr }: { pr: IdlePrDto }) {
  return (
    <Row
      pr={pr.pr}
      className={pr.isDraft && styles.draft}
      Icon={pr.isDraft ? SquircleDashed : Squircle}
      tone={styles.muted}
      title={pr.pr.title}
      age={pr.age}
      ageTone={styles.muted}
    >
      <span className={styles.summaryText}>
        {pr.isDraft ? "Draft" : "Nothing to do"}
      </span>
    </Row>
  );
}

// The two line layout both rows share. Children are the second line's text.
function Row({
  pr,
  className,
  Icon,
  tone,
  title,
  age,
  ageTone,
  children,
}: {
  pr: ItemDto["pr"];
  className: string | false | undefined;
  Icon: LucideIcon;
  tone: string | undefined;
  title: ReactNode;
  age: string;
  ageTone: string | undefined;
  children: ReactNode;
}) {
  return (
    <a
      className={cx(styles.row, className)}
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className={cx(styles.icon, tone)}>
        <Icon />
      </span>
      <span className={styles.title}>{title}</span>
      <span className={cx(styles.age, ageTone)}>{age}</span>
      <span className={styles.summary}>{children}</span>
      <span className={styles.repo}>
        {pr.repo} #{pr.number}
      </span>
    </a>
  );
}
