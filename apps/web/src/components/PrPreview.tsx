import { Drawer } from "@base-ui/react/drawer";
import type {
  ItemDto,
  ItemKind,
  PrPreviewResponse,
  PreviewCommentDto,
} from "@pr-peek/core";
import { Bell, BellOff, CircleX, ExternalLink } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { cx } from "../cx";
import { usePrPreview } from "../queries";
import { GitHubHtml } from "./GitHubHtml";
import { avatarUrl } from "./ItemRow";
import styles from "./PrPreview.module.css";

// What a preview is opened on: a row's PR, and its item if it has one.
export interface PreviewTarget {
  pr: ItemDto["pr"];
  item: ItemDto | null;
}

// Half height, then full. Scrolling the content also makes it full.
const SNAP_POINTS = [0.6, 1];
// Earlier comments after this many come in together.
const MAX_STAGGER = 8;

// A bottom sheet with more about a PR: its title, repo, why it's on the list, the
// comments around that, and the description. Design A3 in docs/13-pr-preview.md.
export function PrPreview({
  target,
  quiet,
  onToggleQuiet,
  onClose,
}: {
  target: PreviewTarget | null;
  quiet: boolean;
  onToggleQuiet: () => void;
  onClose: () => void;
}) {
  // Keeps showing the last PR while the sheet slides away.
  const [shown, setShown] = useState(target);
  const [snapPoint, setSnapPoint] = useState<Drawer.Root.SnapPoint | null>(
    SNAP_POINTS[0]!,
  );
  if (target && target !== shown) {
    setShown(target);
    setSnapPoint(SNAP_POINTS[0]!);
  }

  return (
    <Drawer.Root
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      snapPoints={SNAP_POINTS}
      snapPoint={snapPoint}
      onSnapPointChange={setSnapPoint}
    >
      <Drawer.Portal>
        <Drawer.Backdrop className={styles.backdrop} />
        <Drawer.Viewport className={styles.viewport}>
          <Drawer.Popup className={styles.popup}>
            {shown && (
              <Sheet
                // A new PR starts at the top, with earlier comments closed.
                key={shown.item?.id ?? shown.pr.id}
                target={shown}
                quiet={quiet}
                onToggleQuiet={onToggleQuiet}
                onScroll={() => setSnapPoint(1)}
              />
            )}
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function Sheet({
  target: { pr, item },
  quiet,
  onToggleQuiet,
  onScroll,
}: {
  target: PreviewTarget;
  quiet: boolean;
  onToggleQuiet: () => void;
  onScroll: () => void;
}) {
  const preview = usePrPreview(pr.id, item?.id ?? null);
  const { data } = preview;
  const failing = data?.failingChecks ?? [];
  const QuietIcon = quiet ? Bell : BellOff;
  return (
    <>
      <div className={styles.dragArea}>
        <div className={styles.handle} aria-hidden="true" />
        <div className={styles.bar}>
          <button
            type="button"
            className={styles.barButton}
            onClick={onToggleQuiet}
          >
            <QuietIcon aria-hidden="true" />
            {quiet ? "Bring back" : "Quiet"}
          </button>
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

      <Drawer.Content
        className={styles.scroll}
        onScroll={(event) => {
          if (event.currentTarget.scrollTop > 0) onScroll();
        }}
      >
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
              {pr.author}
              {data && ` · opened ${data.openedAge} ago`}
            </p>
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
        {data && data.comments.length > 0 && !(item && data.focusId) && (
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
// it, and everything after. The rest are behind "See N earlier comments".
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
                  muted
                />
              ))}
            </div>
          </div>
        </>
      )}
      {shown.map((comment) => {
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
            muted={!isFocus && comments.indexOf(comment) < focus}
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
