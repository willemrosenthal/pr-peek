import { Dialog } from "@base-ui/react/dialog";
import { parsePrLink, prUrl, type PrLookupResponse } from "@pr-peek/core";
import { X } from "lucide-react";
import {
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Link } from "react-router";
import { ApiError } from "../api";
import { cx } from "../cx";
import { useDebounced } from "../hooks/useDebounced";
import { useAddPr, usePrLookup } from "../queries";
import styles from "./AddPrDialog.module.css";
import { Button } from "./Button";
import { TextField } from "./Field";

// How long typing pauses before the PR is looked up. Each lookup asks GitHub.
const LOOKUP_AFTER_MS = 400;

// The link in one shape, so every shape of one PR shares a lookup.
function prLinkIn(text: string): string | null {
  const ref = parsePrLink(text);
  return ref && prUrl(ref);
}

// What the dialog says about an error from looking a PR up or adding it.
function errorText(err: Error): ReactNode {
  if (!(err instanceof ApiError)) return err.message;
  if (err.code === "not_found") {
    return (
      <>
        Your GitHub token can't see this PR. Check its repo access in{" "}
        <Link to="/settings/general">Settings</Link>.
      </>
    );
  }
  return err.message;
}

const describe = (pr: PrLookupResponse) =>
  `${pr.owner}/${pr.repo}#${pr.number} · by ${pr.author} · ${pr.state}`;

// Adds a PR by its link: paste it, see the PR, then add it, flagged. Opens with `link`
// filled in, like from a share. `onAdded` gets the PR's row id, to show it.
export function AddPrDialog({
  link,
  onClose,
  onAdded,
}: {
  // Null when closed.
  link: string | null;
  onClose: () => void;
  onAdded: (prId: string) => void;
}) {
  // Opens on the link field, so a link can be pasted right away.
  const field = useRef<HTMLInputElement>(null);
  // The form keeps showing while the dialog fades out. Each opening, or a new shared
  // link, starts a fresh one.
  const [opened, setOpened] = useState({ link: link ?? "", count: 0 });
  const [last, setLast] = useState(link);
  if (link !== last) {
    setLast(link);
    if (link !== null) setOpened({ link, count: opened.count + 1 });
  }
  return (
    <Dialog.Root
      open={link !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Popup className={styles.popup} initialFocus={field}>
          <AddPrForm
            key={opened.count}
            initial={opened.link}
            field={field}
            onAdded={onAdded}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AddPrForm({
  initial,
  field,
  onAdded,
}: {
  initial: string;
  field: RefObject<HTMLInputElement | null>;
  onAdded: (prId: string) => void;
}) {
  const [text, setText] = useState(initial);
  const link = prLinkIn(text);
  // The link it opened with is looked up at once. Changes wait for typing to pause.
  const settled = useDebounced(link, LOOKUP_AFTER_MS);
  const lookup = usePrLookup(settled);
  const add = useAddPr();
  const pr = settled === link ? lookup.data : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!link || !pr) return;
    add.mutate(link, { onSuccess: ({ id }) => onAdded(id) });
  };

  let preview: ReactNode;
  let tone: "empty" | "error" | "tracked" | undefined;
  if (add.error) {
    preview = errorText(add.error);
    tone = "error";
  } else if (!text.trim()) {
    preview = "Paste a link to a pull request on GitHub.";
    tone = "empty";
  } else if (!link) {
    preview = "That doesn't look like a PR link yet.";
    tone = "empty";
  } else if (settled !== link || lookup.isPending) {
    preview = "Looking it up…";
    tone = "empty";
  } else if (lookup.error) {
    preview = errorText(lookup.error);
    tone = "error";
  } else if (pr) {
    preview = (
      <>
        <span className={styles.title}>{pr.title}</span>
        <span className={styles.meta}>{describe(pr)}</span>
        {pr.tracked && (
          <span className={styles.meta}>
            {pr.flagged
              ? "Already on your list, flagged."
              : "Already on your list."}
          </span>
        )}
      </>
    );
    tone = pr.tracked ? "tracked" : undefined;
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.top}>
        <Dialog.Title className={styles.heading}>Add a PR</Dialog.Title>
        <Dialog.Close className={styles.close} aria-label="Close">
          <X aria-hidden="true" />
        </Dialog.Close>
      </div>
      <TextField
        ref={field}
        label="PR link"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          add.reset();
        }}
        type="text"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="https://github.com/owner/repo/pull/123"
      />
      <div
        className={cx(styles.preview, tone && styles[tone])}
        aria-live="polite"
      >
        {preview}
      </div>
      <div className={styles.actions}>
        <Dialog.Close render={<Button />}>Cancel</Dialog.Close>
        <Button type="submit" variant="primary" disabled={!pr || add.isPending}>
          {!pr?.tracked
            ? "Add as important"
            : pr.flagged
              ? "Show it"
              : "Flag it"}
        </Button>
      </div>
    </form>
  );
}
