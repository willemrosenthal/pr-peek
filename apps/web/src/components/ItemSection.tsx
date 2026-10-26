import { Collapsible } from "@base-ui/react/collapsible";
import type { IdlePrDto, ItemDto } from "@pr-peek/core";
import { ChevronRight } from "lucide-react";
import { usePrefetchPreview, useSetQuiet } from "../queries";
import { IdlePrRow, ItemRow } from "./ItemRow";
import styles from "./ItemSection.module.css";
import type { PreviewTarget } from "./PrPreview";
import { SwipeRow } from "./SwipeRow";

// A section of the list. `idle` PRs come after the items. Rows in the `quiet` section
// are one line, and swiping one brings it back. A long press on a row calls
// `onPreview`. The list shows the sheet, so it stays open if this section goes away.
export function ItemSection({
  title,
  items,
  idle = [],
  quiet = false,
  showAuthors = false,
  open,
  onOpenChange,
  onPreview,
}: {
  title: string;
  items: ItemDto[];
  idle?: IdlePrDto[];
  quiet?: boolean;
  showAuthors?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreview: (target: PreviewTarget) => void;
}) {
  const setQuiet = useSetQuiet();
  const prefetch = usePrefetchPreview();
  const toggle = (prId: string) => () =>
    setQuiet.mutate({ prId, quiet: !quiet });
  const previewOn = (pr: ItemDto["pr"], item: ItemDto | null) => ({
    onLongPress: () => onPreview({ pr, item, quiet }),
    onPressStart: () => prefetch(pr.id, item?.id ?? null),
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
            {...previewOn(item.pr, item)}
          >
            <ItemRow item={item} quiet={quiet} showAuthor={showAuthors} />
          </SwipeRow>
        ))}
        {idle.map((pr) => (
          <SwipeRow
            key={pr.id}
            quiet={quiet}
            onToggle={toggle(pr.id)}
            {...previewOn(pr.pr, null)}
          >
            <IdlePrRow pr={pr} quiet={quiet} showAuthor={showAuthors} />
          </SwipeRow>
        ))}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
