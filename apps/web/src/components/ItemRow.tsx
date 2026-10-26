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
import { useState, type ReactNode } from "react";
import { cx } from "../cx";
import styles from "./ItemRow.module.css";

const KIND_ICONS: Record<
  ItemKind,
  { Icon: LucideIcon; tone: string | undefined }
> = {
  review_requested: { Icon: Eye, tone: styles.review },
  re_requested: { Icon: RefreshCw, tone: styles.review },
  reply: { Icon: MessageCircle, tone: styles.talk },
  mention: { Icon: AtSign, tone: styles.talk },
  reviewed: { Icon: CircleCheck, tone: styles.approved },
  commented: { Icon: MessageSquareText, tone: styles.comment },
  check_failed: { Icon: CircleX, tone: styles.failed },
};

const AGE_TONES: Record<StaleLevel, string | undefined> = {
  fresh: styles.muted,
  warn: styles.warning,
  late: styles.danger,
};

// Whether a row shows the dot: something new on it, or the user marked it unread.
export const showsDot = (pr: ItemDto["pr"], item: ItemDto | null) =>
  pr.markedUnread || (item?.unseen ?? false);

// What a screen reader hears before the title of a row with the dot.
const dotLabel = (item: ItemDto | null) =>
  item?.unseen ? "New: " : "Unread: ";

// One item, as two lines: what PR and how long, then what happened and where. A quiet
// one is a single grey line. `onOpen` is called when its link opens.
export function ItemRow({
  item,
  quiet = false,
  showAuthor = false,
  onOpen,
}: {
  item: ItemDto;
  quiet?: boolean;
  showAuthor?: boolean;
  onOpen?: () => void;
}) {
  const { Icon: KindIcon, tone } = KIND_ICONS[item.kind];
  const botComment = item.actorIsBot && item.kind === "commented";
  const dot = showsDot(item.pr, item) && !quiet;
  return (
    <Row
      pr={item.pr}
      quiet={quiet}
      showAuthor={showAuthor}
      className={dot ? styles.unseen : undefined}
      onOpen={onOpen}
      // Keeps the kind's color, so a bot's approval still reads as an approval.
      // Bot comments get their own color.
      Icon={item.actorIsBot ? BotMessageSquare : KindIcon}
      tone={botComment ? styles.bot : tone}
      title={
        <>
          {dot && <span className="visually-hidden">{dotLabel(item)}</span>}
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
export function IdlePrRow({
  pr,
  quiet = false,
  showAuthor = false,
  onOpen,
}: {
  pr: IdlePrDto;
  quiet?: boolean;
  showAuthor?: boolean;
  onOpen?: () => void;
}) {
  const dot = showsDot(pr.pr, null) && !quiet;
  return (
    <Row
      pr={pr.pr}
      quiet={quiet}
      showAuthor={showAuthor}
      className={cx(pr.isDraft && !quiet && styles.draft, dot && styles.unseen)}
      onOpen={onOpen}
      Icon={pr.isDraft ? SquircleDashed : Squircle}
      tone={styles.muted}
      title={
        <>
          {dot && <span className="visually-hidden">{dotLabel(null)}</span>}
          {pr.pr.title}
        </>
      }
      age={pr.age}
      ageTone={styles.muted}
    >
      <span className={styles.summaryText}>
        {pr.isDraft ? "Draft" : "Nothing to do"}
      </span>
    </Row>
  );
}

// The two line layout both rows share. Children are the second line's text, which a
// quiet row leaves out. Quiet rows keep the plain icon, without the author.
function Row({
  pr,
  quiet,
  showAuthor,
  className,
  onOpen,
  Icon,
  tone,
  title,
  age,
  ageTone,
  children,
}: {
  pr: ItemDto["pr"];
  quiet: boolean;
  showAuthor: boolean;
  className: string | undefined;
  onOpen: (() => void) | undefined;
  Icon: LucideIcon;
  tone: string | undefined;
  title: ReactNode;
  age: string;
  ageTone: string | undefined;
  children: ReactNode;
}) {
  const withAuthor = showAuthor && !quiet;
  return (
    <a
      className={cx(
        styles.row,
        quiet && styles.quiet,
        withAuthor && styles.withAuthor,
        className,
      )}
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onOpen}
    >
      {withAuthor ? (
        <Author login={pr.author} Icon={Icon} tone={tone} />
      ) : (
        <RowIcon Icon={Icon} tone={tone} />
      )}
      <span className={styles.line}>
        <span className={styles.title}>{title}</span>
        <span className={cx(styles.age, ageTone)}>{age}</span>
      </span>
      {!quiet && (
        <span className={styles.line}>
          <span className={styles.summary}>{children}</span>
          <span className={styles.repo}>
            <span style={pr.color ? { color: pr.color } : undefined}>
              {pr.repo}
            </span>{" "}
            #{pr.number}
          </span>
        </span>
      )}
    </a>
  );
}

interface IconProps {
  Icon: LucideIcon;
  tone: string | undefined;
}

// Why the PR is on the list.
function RowIcon({ Icon, tone }: IconProps) {
  return (
    <span className={cx(styles.icon, tone)}>
      <Icon />
    </span>
  );
}

export const avatarUrl = (login: string) =>
  `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=56`;

// The author's picture, with the row's icon in a badge on its corner. Just the icon if
// the picture can't load.
function Author({ login, Icon, tone }: IconProps & { login: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <RowIcon Icon={Icon} tone={tone} />;
  return (
    <span className={styles.author}>
      <img
        className={styles.avatar}
        src={avatarUrl(login)}
        alt=""
        title={login}
        onError={() => setFailed(true)}
      />
      <span className={cx(styles.badge, tone)}>
        <Icon />
      </span>
    </span>
  );
}
