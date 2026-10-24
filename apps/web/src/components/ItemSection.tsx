import { Collapsible } from "@base-ui/react/collapsible";
import type { IdlePrDto, ItemDto } from "@pr-peek/core";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { usePrefetchPreview, useSetQuiet } from "../queries";
import { IdlePrRow, ItemRow } from "./ItemRow";
import styles from "./ItemSection.module.css";
import { PrPreview, type PreviewTarget } from "./PrPreview";
import { SwipeRow } from "./SwipeRow";

// A section of the list. `idle` PRs come after the items. Rows in the `quiet` section
// are one line, and swiping one brings it back. A long press on a row opens its preview.
export function ItemSection({
  title,
  items,
  idle = [],
  quiet = false,
  showAuthors = false,
  open,
  onOpenChange,
}: {
  title: string;
  items: ItemDto[];
  idle?: IdlePrDto[];
  quiet?: boolean;
  showAuthors?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setQuiet = useSetQuiet();
  const prefetch = usePrefetchPreview();
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const toggle = (prId: string) => () =>
    setQuiet.mutate({ prId, quiet: !quiet });
  const previewOn = (target: PreviewTarget) => ({
    onLongPress: () => setPreview(target),
    onPressStart: () => prefetch(target.pr.id, target.item?.id ?? null),
  });
  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange}>
      <h2 className={styles.heading}>
        <Collapsible.Trigger className={styles.trigger}>
          <ChevronRight size={10} className={styles.chevron} />
          <span className={styles.title}>{title}</span>
          <span>{items.length + idle.length}</span>
        </Collapsible.Trigger>
      </h2>
      <Collapsible.Panel>
        {items.map((item) => (
          <SwipeRow
            key={item.id}
            quiet={quiet}
            onToggle={toggle(item.pr.id)}
            {...previewOn({ pr: item.pr, item })}
          >
            <ItemRow item={item} quiet={quiet} showAuthor={showAuthors} />
          </SwipeRow>
        ))}
        {idle.map((pr) => (
          <SwipeRow
            key={pr.id}
            quiet={quiet}
            onToggle={toggle(pr.id)}
            {...previewOn({ pr: pr.pr, item: null })}
          >
            <IdlePrRow pr={pr} quiet={quiet} showAuthor={showAuthors} />
          </SwipeRow>
        ))}
      </Collapsible.Panel>
      <PrPreview
        target={preview}
        quiet={quiet}
        // The row moves, like after a swipe, so the sheet closes.
        onToggleQuiet={() => {
          if (preview) toggle(preview.pr.id)();
          setPreview(null);
        }}
        onClose={() => setPreview(null)}
      />
    </Collapsible.Root>
  );
}
