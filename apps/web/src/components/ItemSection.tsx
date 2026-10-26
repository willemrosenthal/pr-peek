import { Collapsible } from "@base-ui/react/collapsible";
import type { IdlePrDto, ItemDto } from "@pr-peek/core";
import { ChevronRight } from "lucide-react";
import { useMarkUnread, usePrefetchPreview, useSetQuiet } from "../queries";
import { showsDot } from "../unread";
import { IdlePrRow, ItemRow } from "./ItemRow";
import styles from "./ItemSection.module.css";
import type { OnPreview } from "./PrPreview";
import { SwipeRow } from "./SwipeRow";

// A section of the list. `idle` PRs come after the items. Rows in the `quiet` section
// are one line, and swiping one brings it back. Opening a row the user marked unread
// marks it read. A long press on a row calls `onPreview`. The list shows the sheet, so
// it stays open if this section goes away.
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
  onPreview: OnPreview;
}) {
  const setQuiet = useSetQuiet();
  const unread = useMarkUnread();
  const prefetch = usePrefetchPreview();
  const toggle = (prId: string) => () =>
    setQuiet.mutate({ prId, quiet: !quiet });
  // Swipe and long press. Quiet rows show no dot, so they don't mark unread.
  const rowProps = (pr: ItemDto["pr"], item: ItemDto | null) => ({
    quiet,
    onToggle: toggle(pr.id),
    unread: showsDot(pr, item),
    onToggleUnread: quiet ? undefined : () => unread.toggle(pr, item),
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
          <SwipeRow key={item.id} {...rowProps(item.pr, item)}>
            <ItemRow
              item={item}
              quiet={quiet}
              showAuthor={showAuthors}
              onOpen={() => unread.readIfMarked(item.pr)}
            />
          </SwipeRow>
        ))}
        {idle.map((pr) => (
          <SwipeRow key={pr.id} {...rowProps(pr.pr, null)}>
            <IdlePrRow
              pr={pr}
              quiet={quiet}
              showAuthor={showAuthors}
              onOpen={() => unread.readIfMarked(pr.pr)}
            />
          </SwipeRow>
        ))}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
