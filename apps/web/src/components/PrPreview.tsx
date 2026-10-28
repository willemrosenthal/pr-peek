import { Drawer } from "@base-ui/react/drawer";
import type {
  ItemDto,
  ItemKind,
  PrPreviewResponse,
  PreviewCommentDto,
  ReviewerDto,
  ReviewerStatus,
} from "@pr-peek/core";
import {
  Bell,
  BellOff,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  ExternalLink,
  Flag,
  FlagOff,
  MessageCircle,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cx } from "../cx";
import { usePrPreview } from "../queries";
import { GitHubHtml } from "./GitHubHtml";
import { avatarUrl } from "./ItemRow";
import styles from "./PrPreview.module.css";

// What a preview is opened on: a row's PR, its item if it has one, whether it's in the
// Quiet section, and whether it merged.
export interface PreviewTarget {
  pr: ItemDto["pr"];
  item: ItemDto | null;
  quiet: boolean;
  merged?: boolean;
}

// Opens the preview on a row. The list passes it down to its rows.
export type OnPreview = (target: PreviewTarget) => void;

// Earlier comments after this many come in together.
const MAX_STAGGER = 8;

// Letting go of the sheet this far down closes it: a share of its height, but at least
// CLOSE_MIN_PX. Base UI alone needs half its height, which is a long pull on a tall sheet.
const CLOSE_SHARE = 0.15;
const CLOSE_MIN_PX = 80;

// The top bar's buttons: Quiet (or Bring back), and Important (or Remove flag).
interface SheetActions {
  onToggleQuiet: () => void;
  onToggleImportant: () => void;
}

// A bottom sheet with more about a PR: its title, repo, why it's on the list, the
// description, and the conversation. Design A3 in docs/13-pr-preview.md. One height;
// swipe down to close.
export function PrPreview({
  target,
  onToggleQuiet,
  onToggleImportant,
  onClose,
}: {
  target: PreviewTarget | null;
  onClose: () => void;
} & SheetActions) {
  // Keeps showing the last PR while the sheet slides away.
  const [shown, setShown] = useState(target);
  // Focus goes to the sheet itself, not its first button. Screen readers still start
  // at the sheet. Its focus ring is off in the CSS.
  const popupRef = useRef<HTMLDivElement>(null);
  if (target && target !== shown) setShown(target);

  // How far the sheet is dragged down, from the variable Base UI sets on it while it's
  // dragged. Kept from the last move, since Base UI resets it when the drag ends. Each
  // press starts from 0, so a drag the browser cancelled can't close it on a later tap.
  const dragged = useRef(0);
  const startDrag = () => (dragged.current = 0);
  const trackDrag = () => {
    const value = popupRef.current?.style.getPropertyValue(
      "--drawer-swipe-movement-y",
    );
    dragged.current = Number.parseFloat(value ?? "") || 0;
  };
  const endDrag = () => {
    const height = popupRef.current?.offsetHeight ?? 0;
    const far = dragged.current >= Math.max(CLOSE_MIN_PX, height * CLOSE_SHARE);
    dragged.current = 0;
    if (far) onClose();
  };

  return (
    <Drawer.Root
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Drawer.Portal>
        <Drawer.Backdrop className={styles.backdrop} />
        <Drawer.Viewport className={styles.viewport}>
          <Drawer.Popup
            ref={popupRef}
            // Still on screen with no target: it's sliding away. Base UI's own mark for
            // that, data-ending-style, doesn't do here. A phone ends Base UI's drag after
            // ours, and short of half the sheet's height, Base UI takes the mark off and
            // springs the sheet back up.
            className={cx(styles.popup, !target && styles.closing)}
            initialFocus={popupRef}
            // Pointer moves track the drag, on a phone too: Base UI keeps its touch moves
            // to itself. A phone also sends touch start and end, after the pointer ones,
            // in case the browser cancels the pointer. endDrag only acts once.
            onPointerDown={startDrag}
            onTouchStart={startDrag}
            onPointerMove={trackDrag}
            onPointerUp={endDrag}
            onTouchEnd={endDrag}
          >
            {shown && (
              <Sheet
                // A new PR starts at the top, with earlier comments closed.
                key={shown.item?.id ?? shown.pr.id}
                target={shown}
                onToggleQuiet={onToggleQuiet}
                onToggleImportant={onToggleImportant}
              />
            )}
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function Sheet({
  target: { pr, item, quiet, merged = false },
  onToggleQuiet,
  onToggleImportant,
}: {
  target: PreviewTarget;
} & SheetActions) {
  const preview = usePrPreview(pr.id, item?.id ?? null);
  const { data } = preview;
  const failing = data?.failingChecks ?? [];
  const QuietIcon = quiet ? Bell : BellOff;
  return (
    <>
      <div className={styles.dragArea}>
        <div className={styles.handle} aria-hidden="true" />
        <div className={styles.bar}>
          <div className={styles.barGroup}>
            {/* A merged PR has nothing new to quiet. */}
            {!merged && (
              <button
                type="button"
                className={styles.barButton}
                onClick={onToggleQuiet}
              >
                <QuietIcon aria-hidden="true" />
                {quiet ? "Bring back" : "Quiet"}
              </button>
            )}
            {/* Quiet rows show no flag. */}
            {!quiet && (
              <button
                type="button"
                className={styles.barButton}
                onClick={onToggleImportant}
              >
                {pr.important ? (
                  <FlagOff aria-hidden="true" />
                ) : (
                  <Flag aria-hidden="true" />
                )}
                {pr.important ? "Remove flag" : "Important"}
              </button>
            )}
          </div>
          <a
            className={cx(styles.barButton, styles.open)}
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open
            <ExternalLink aria-hidden="true" />
          </a>
        </div>
      </div>

      <Drawer.Content className={styles.scroll}>
        <section className={styles.card}>
          <div className={styles.cardBody}>
            <p className={styles.repo}>
              {pr.color && (
                <span className={styles.dot} style={{ background: pr.color }} />
              )}
              {pr.owner} / {pr.repo}
              <span className={styles.number}>#{pr.number}</span>
            </p>
            <Drawer.Title className={styles.title}>{pr.title}</Drawer.Title>
            <p className={styles.meta}>
              <Avatar login={pr.author} />
              <span>
                {pr.author}
                {data && ` · opened ${data.openedAge} ago`}
              </span>
            </p>
            {data && data.reviewers.length > 0 && (
              <Reviewers reviewers={data.reviewers} />
            )}
          </div>
          {failing.length > 0 && (
            <p className={styles.checks}>
              <CircleX aria-hidden="true" />
              <span>
                <strong>
                  {failing.length === 1
                    ? "1 check failing:"
                    : `${failing.length} checks failing:`}
                </strong>{" "}
                {failing.join(", ")}
              </span>
            </p>
          )}
        </section>

        {item && <ForYou item={item} preview={data} />}

        {preview.isPending && (
          <Group label="Description">
            <div className={cx(styles.card, styles.cardBody)}>
              <span className={styles.skeleton} />
              <span className={styles.skeleton} />
              <span className={cx(styles.skeleton, styles.short)} />
            </div>
          </Group>
        )}
        {preview.isError && (
          <div className={cx(styles.card, styles.cardBody, styles.error)}>
            <p>Couldn't load the details.</p>
            <button
              type="button"
              className={styles.link}
              onClick={() => void preview.refetch()}
            >
              Try again
            </button>
          </div>
        )}
        {data?.bodyHtml && (
          <Group label="Description">
            <GitHubHtml
              html={data.bodyHtml}
              className={cx(styles.card, styles.padded)}
            />
          </Group>
        )}
        {/* With the item's comment, the conversation is in "For you" instead. */}
        {data && data.comments.length > 0 && !data.focusId && (
          <Group label="Comments">
            <div className={styles.card}>
              <Comments comments={data.comments} focusId={null} kind={null} />
            </div>
          </Group>
        )}
      </Drawer.Content>
    </>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      <h3 className={styles.label}>{label}</h3>
      {children}
    </section>
  );
}

// Why the PR is on the list: the conversation with the item's comment marked, or
// just the item's summary, like for a review request.
function ForYou({
  item,
  preview,
}: {
  item: ItemDto;
  preview: PrPreviewResponse | undefined;
}) {
  return (
    <Group label="For you">
      <div className={styles.card}>
        {preview?.focusId ? (
          <Comments
            comments={preview.comments}
            focusId={preview.focusId}
            kind={item.kind}
          />
        ) : (
          <div className={styles.comment}>
            <Avatar login={item.actorLogin} />
            <p className={styles.reason}>
              <span>{item.summary}</span>
              <span className={styles.age}>{item.age}</span>
            </p>
          </div>
        )}
      </div>
    </Group>
  );
}

// The conversation, oldest first. Shows the focus comment (or the last), the one before
// it, and everything after. The rest are behind "See N earlier comments". Comments
// before the focus are greyed.
function Comments({
  comments,
  focusId,
  kind,
}: {
  comments: PreviewCommentDto[];
  focusId: string | null;
  kind: ItemKind | null;
}) {
  const [open, setOpen] = useState(false);
  const found = comments.findIndex((comment) => comment.id === focusId);
  const focus = found === -1 ? comments.length - 1 : found;
  const hidden = comments.slice(0, Math.max(focus - 1, 0));
  const shown = comments.slice(hidden.length);

  return (
    <>
      {hidden.length > 0 && (
        <>
          <button
            type="button"
            className={cx(styles.link, styles.more)}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open
              ? "Hide earlier comments"
              : `See ${hidden.length} earlier comment${hidden.length === 1 ? "" : "s"}`}
          </button>
          <div
            className={styles.earlier}
            data-open={open || undefined}
            inert={!open}
          >
            <div className={styles.earlierInner}>
              {hidden.map((comment, index) => (
                <Comment
                  key={comment.id}
                  comment={comment}
                  label={reviewLabel(comment)}
                  style={
                    { "--i": Math.min(index, MAX_STAGGER) } as CSSProperties
                  }
                  muted={found !== -1}
                />
              ))}
            </div>
          </div>
        </>
      )}
      {shown.map((comment, index) => {
        const isFocus = comment.id === focusId;
        return (
          <Comment
            key={comment.id}
            comment={comment}
            label={
              reviewLabel(comment) ??
              (isFocus && kind ? KIND_LABELS[kind] : undefined)
            }
            focus={isFocus}
            muted={found !== -1 && hidden.length + index < focus}
          />
        );
      })}
    </>
  );
}

interface Label {
  text: string;
  tone: string | undefined;
}

const KIND_LABELS: Partial<Record<ItemKind, Label>> = {
  reply: { text: "replied to you", tone: styles.talk },
  mention: { text: "mentioned you", tone: styles.talk },
};

function reviewLabel(comment: PreviewCommentDto): Label | undefined {
  switch (comment.reviewState) {
    case "APPROVED":
      return { text: "approved", tone: styles.approved };
    case "CHANGES_REQUESTED":
      return { text: "requested changes", tone: styles.changes };
    case "COMMENTED":
      return { text: "reviewed", tone: undefined };
    default:
      return undefined;
  }
}

function Comment({
  comment,
  label,
  focus = false,
  muted = false,
  style,
}: {
  comment: PreviewCommentDto;
  label: Label | undefined;
  focus?: boolean;
  muted?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cx(
        styles.comment,
        focus && styles.focus,
        muted && styles.mutedComment,
      )}
      style={style}
    >
      <Avatar login={comment.author} />
      <div className={styles.commentBody}>
        <p className={styles.commentHead}>
          <strong>{comment.author}</strong>
          {label && <span className={label.tone}> {label.text}</span>}
          {comment.where && (
            <>
              {" on "}
              <code className={styles.where}>{comment.where}</code>
            </>
          )}
          <span className={styles.age}> · {comment.age}</span>
        </p>
        {comment.bodyHtml && <GitHubHtml html={comment.bodyHtml} />}
      </div>
    </div>
  );
}

// Where each reviewer stands, as an icon with a label for screen readers and hover.
const REVIEWER_STATUS: Record<
  ReviewerStatus,
  { Icon: LucideIcon; label: string; tone: string | undefined }
> = {
  requested: { Icon: Clock, label: "waiting", tone: styles.neutral },
  approved: { Icon: CircleCheck, label: "approved", tone: styles.approved },
  changes_requested: {
    Icon: CircleAlert,
    label: "requested changes",
    tone: styles.changes,
  },
  commented: { Icon: MessageCircle, label: "commented", tone: styles.neutral },
};

// Everyone asked to review and everyone who has, each with their picture and an icon
// for where they stand. Teams get a team icon.
function Reviewers({ reviewers }: { reviewers: ReviewerDto[] }) {
  return (
    <div className={styles.reviewers}>
      <span className={styles.reviewersLabel}>Reviewers</span>
      <ul className={styles.reviewerList}>
        {reviewers.map((reviewer) => {
          const { Icon, label, tone } = REVIEWER_STATUS[reviewer.status];
          return (
            <li key={reviewer.name} className={styles.reviewer}>
              {reviewer.isTeam ? (
                <span className={styles.avatar} aria-hidden="true">
                  <Users />
                </span>
              ) : (
                <Avatar login={reviewer.name} />
              )}
              {reviewer.isYou ? "You" : reviewer.name}
              <span className={cx(styles.reviewerStatus, tone)} title={label}>
                <Icon aria-hidden="true" />
                <span className="visually-hidden">, {label}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// The person's picture, or their first letter if it can't load.
function Avatar({ login }: { login: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!login || failed) {
    return (
      <span className={styles.avatar} aria-hidden="true">
        {login?.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className={styles.avatar}
      src={avatarUrl(login)}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}
