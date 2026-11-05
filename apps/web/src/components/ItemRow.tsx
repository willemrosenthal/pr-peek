import type {
  AssignedState,
  IdlePrDto,
  ItemDto,
  ItemKind,
  MergedPrDto,
  StaleLevel,
} from "@pr-peek/core";
import {
  AtSign,
  BotMessageSquare,
  CircleCheck,
  CircleDashed,
  CircleUserRound,
  CircleX,
  Eye,
  Flag,
  GitMerge,
  MessageCircle,
  MessageCircleQuestionMark,
  MessageSquareText,
  RefreshCw,
  Squircle,
  SquircleDashed,
  TriangleAlert,
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
  assigned: { Icon: CircleUserRound, tone: styles.assigned },
};

// A review that's the author's turn. Talk's color, like replies: it's a conversation.
const WAITING_ICON = { Icon: MessageCircleQuestionMark, tone: styles.talk };

// What an assigned PR needs next, before the summary. Its color says what to do.
const ASSIGNED_STATES: Record<
  AssignedState,
  { label: string; Icon: LucideIcon; tone: string | undefined }
> = {
  draft: { label: "Draft", Icon: SquircleDashed, tone: styles.muted },
  conflicts: {
    label: "Has conflicts",
    Icon: TriangleAlert,
    tone: styles.warning,
  },
  checks_failing: {
    label: "Checks failing",
    Icon: CircleX,
    tone: styles.failed,
  },
  changes_requested: {
    label: "Changes requested",
    Icon: MessageSquareText,
    tone: styles.comment,
  },
  ready_to_merge: {
    label: "Ready to merge",
    Icon: GitMerge,
    tone: styles.approved,
  },
  checks_running: {
    label: "Checks running",
    Icon: CircleDashed,
    tone: styles.muted,
  },
  waiting_on_review: {
    label: "Waiting on review",
    Icon: CircleUserRound,
    tone: styles.muted,
  },
};

const AGE_TONES: Record<StaleLevel, string | undefined> = {
  fresh: styles.muted,
  warn: styles.warning,
  late: styles.danger,
};

// One item, as two lines: what PR and how long, then what happened and where. A quiet
// one is a single grey line.
export function ItemRow({
  item,
  quiet = false,
  showAuthor = false,
}: {
  item: ItemDto;
  quiet?: boolean;
  showAuthor?: boolean;
}) {
  const { Icon: KindIcon, tone } = item.waitingOnAuthor
    ? WAITING_ICON
    : KIND_ICONS[item.kind];
  const botComment = item.actorIsBot && item.kind === "commented";
  return (
    <Row
      pr={item.pr}
      quiet={quiet}
      showAuthor={showAuthor}
      className={
        quiet
          ? undefined
          : cx(
              item.unseen && styles.unseen,
              item.waitingOnAuthor && styles.waiting,
            )
      }
      // Keeps the kind's color, so a bot's approval still reads as an approval.
      // Bot comments get their own color.
      Icon={item.actorIsBot ? BotMessageSquare : KindIcon}
      tone={botComment ? styles.bot : tone}
      title={
        <>
          {item.unseen && !quiet && (
            <span className="visually-hidden">New: </span>
          )}
          <ImportantFlag pr={item.pr} />
          {item.pr.title}
        </>
      }
      age={item.age}
      // Only review requests have a stale level.
      ageTone={item.staleLevel ? AGE_TONES[item.staleLevel] : styles.muted}
    >
      {item.waitingOnAuthor && (
        <span className={styles.tag}>Waiting on author</span>
      )}
      {/* An assigned row says so with its icon and state. Other rows need the tag. */}
      {item.assigned && !item.assignedState && (
        <span className={styles.tag}>Assigned</span>
      )}
      {item.assignedState && <StateLabel state={item.assignedState} />}
      <span className={styles.summaryText}>{item.summary}</span>
      {item.otherIds.length > 0 && (
        <span className={styles.more}>+{item.otherIds.length} more</span>
      )}
    </Row>
  );
}

function StateLabel({ state }: { state: AssignedState }) {
  const { label, Icon, tone } = ASSIGNED_STATES[state];
  return (
    <span className={cx(styles.state, tone)}>
      <Icon />
      {label}
    </span>
  );
}

// One of the user's PRs with nothing to do. Drafts are dimmed. Without `flag`, an
// important one shows no flag, like in Watching, where every row is flagged.
export function IdlePrRow({
  pr,
  quiet = false,
  showAuthor = false,
  flag = true,
}: {
  pr: IdlePrDto;
  quiet?: boolean;
  showAuthor?: boolean;
  flag?: boolean;
}) {
  return (
    <Row
      pr={pr.pr}
      quiet={quiet}
      showAuthor={showAuthor}
      className={pr.isDraft && !quiet ? styles.draft : undefined}
      Icon={pr.isDraft ? SquircleDashed : Squircle}
      tone={styles.muted}
      title={
        <>
          {flag && <ImportantFlag pr={pr.pr} />}
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

// A PR the user marked important that merged. It stays until they remove the flag.
// Without `flag`, it shows no flag, like an idle row.
export function MergedPrRow({
  pr,
  showAuthor = false,
  flag = true,
}: {
  pr: MergedPrDto;
  showAuthor?: boolean;
  flag?: boolean;
}) {
  return (
    <Row
      pr={pr.pr}
      quiet={false}
      showAuthor={showAuthor}
      className={undefined}
      Icon={GitMerge}
      tone={styles.merged}
      title={
        <>
          {flag && <ImportantFlag pr={pr.pr} />}
          {pr.pr.title}
        </>
      }
      age={pr.age}
      ageTone={styles.muted}
    >
      <span className={cx(styles.tag, styles.mergedTag)}>Merged</span>
    </Row>
  );
}

// The two line layout the rows share. Children are the second line's text, which a
// quiet row leaves out. Quiet rows keep the plain icon, without the author.
function Row({
  pr,
  quiet,
  showAuthor,
  className,
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

// A flag before the title of a PR the user marked important, after the dot. Smaller on
// a quiet row, where it sits right after the icon.
function ImportantFlag({ pr }: { pr: ItemDto["pr"] }) {
  if (!pr.important) return null;
  return (
    <>
      <Flag className={styles.flag} aria-hidden="true" />
      <span className="visually-hidden">Important: </span>
    </>
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
