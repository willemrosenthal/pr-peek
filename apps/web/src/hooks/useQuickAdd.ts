import { parsePrLink, prUrl } from "@pr-peek/core";
import { useCallback, useEffect, useState, type DragEvent } from "react";
import { errorText } from "../components/AddPrDialog";
import type { ToastMessage } from "../components/Toast";
import { useAddPr, useSetImportant } from "../queries";

// True when the event is in a text field, where paste is for the field.
const isTyping = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest("input, textarea, [contenteditable]") !== null;

// A link dragged from a browser comes as a URL list, then as text.
const droppedText = (data: DataTransfer) =>
  data.getData("text/uri-list") || data.getData("text/plain");

const isTextDrag = (data: DataTransfer) =>
  data.types.includes("text/uri-list") || data.types.includes("text/plain");

// Adds a PR from a link pasted or dropped on the list, without the dialog. Says how it
// went in a toast, with Undo for a PR it just flagged. Text that isn't a PR link is
// left alone. Off while a dialog or sheet is open (`enabled`).
export function useQuickAdd({
  enabled,
  onAdded,
  onToast,
}: {
  enabled: boolean;
  onAdded: (prId: string) => void;
  onToast: (toast: ToastMessage) => void;
}) {
  const { mutate: add } = useAddPr();
  const setImportant = useSetImportant();
  // A text drag is over the list, so it shows where to drop.
  const [dragging, setDragging] = useState(false);

  // True if `text` had a PR link to add.
  const addFrom = useCallback(
    (text: string) => {
      const ref = parsePrLink(text);
      if (!ref) return false;
      const name = `${ref.owner}/${ref.repo}#${ref.number}`;
      add(prUrl(ref), {
        onSuccess: ({ id, alreadyFlagged }) => {
          onAdded(id);
          // No Undo for a PR flagged before, so Undo never takes away the user's flag.
          onToast(
            alreadyFlagged
              ? { text: "Already on your list" }
              : {
                  text: `Added ${name}`,
                  action: {
                    label: "Undo",
                    onClick: () => setImportant({ prId: id, important: false }),
                  },
                },
          );
        },
        onError: (err) => onToast({ text: errorText(err) }),
      });
      return true;
    },
    [add, setImportant, onAdded, onToast],
  );

  useEffect(() => {
    if (!enabled) return;
    const onPaste = (event: ClipboardEvent) => {
      if (isTyping(event.target)) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (addFrom(text)) event.preventDefault();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [enabled, addFrom]);

  // For the list's element. The dragged text can only be read on drop, so the outline
  // shows for any text.
  const dropTarget = {
    onDragOver: (event: DragEvent) => {
      if (!enabled || !isTextDrag(event.dataTransfer)) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: (event: DragEvent) => {
      // Moving onto a row inside the list isn't leaving it.
      if (event.currentTarget.contains(event.relatedTarget as Node | null))
        return;
      setDragging(false);
    },
    // Always takes the drop it allowed. Otherwise the browser opens the dropped link,
    // leaving the app.
    onDrop: (event: DragEvent) => {
      setDragging(false);
      if (!enabled) return;
      event.preventDefault();
      addFrom(droppedText(event.dataTransfer));
    },
  };

  return { dragging, dropTarget };
}
