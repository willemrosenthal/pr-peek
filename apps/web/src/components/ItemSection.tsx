import { Collapsible } from "@base-ui/react/collapsible";
import type { IdlePrDto, ItemDto, MergedPrDto } from "@pr-peek/core";
import { ChevronRight } from "lucide-react";
import {
  usePrefetchPreview,
  useSetQuiet,
  useToggleImportant,
} from "../queries";
import { IdlePrRow, ItemRow, MergedPrRow } from "./ItemRow";
import styles from "./ItemSection.module.css";
import type { OnPreview } from "./PrPreview";
import { SwipeRow } from "./SwipeRow";

// A section of the list. `idle` PRs come after the items, then `merged` ones, which a
// swipe either way unflags, taking them off the list. Rows in the `quiet` section
// are one line, and swiping one brings it back. A long press on a row calls
// `onPreview`. The list shows the sheet, so it stays open if this section goes away.
export function ItemSection({
  title,
  items,
  idle = [],
  merged = [],
  quiet = false,
  showAuthors = false,
  open,
  onOpenChange,
  onPreview,
}: {
  title: string;
  items: ItemDto[];
  idle?: IdlePrDto[];
  merged?: MergedPrDto[];
  quiet?: boolean;
  showAuthors?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreview: OnPreview;
}) {
  const setQuiet = useSetQuiet();
  const toggleImportant = useToggleImportant();
  const prefetch = usePrefetchPreview();
  const toggle = (prId: string) => () =>
    setQuiet.mutate({ prId, quiet: !quiet });
  // Swipe and long press. Merged rows unflag on any swipe, instead of quieting.
  const rowProps = (
    pr: ItemDto["pr"],
    item: ItemDto | null,
    merged = false,
  ) => ({
    quiet,
    onToggle: merged ? () => toggleImportant(pr) : toggle(pr.id),
    unflags: merged,
    important: pr.important,
    onToggleImportant: merged ? undefined : () => toggleImportant(pr),
    onLongPress: () => onPreview({ pr, item, quiet, merged }),
    onPressStart: () => prefetch(pr.id, item?.id ?? null),
  });
  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange}>
      <h2 className={styles.heading}>
        <Collapsible.Trigger className={styles.trigger}>
          <ChevronRight size={10} className={styles.chevron} />
          <span className={styles.title}>{title}</span>
          <span>{items.length + idle.length + merged.length}</span>
        </Collapsible.Trigger>
      </h2>
      <Collapsible.Panel>
        {items.map((item) => (
          <SwipeRow key={item.id} {...rowProps(item.pr, item)}>
            <ItemRow item={item} quiet={quiet} showAuthor={showAuthors} />
          </SwipeRow>
        ))}
        {idle.map((pr) => (
          <SwipeRow key={pr.id} {...rowProps(pr.pr, null)}>
            <IdlePrRow pr={pr} quiet={quiet} showAuthor={showAuthors} />
          </SwipeRow>
        ))}
        {merged.map((pr) => (
          <SwipeRow key={pr.id} {...rowProps(pr.pr, null, true)}>
            <MergedPrRow pr={pr} showAuthor={showAuthors} />
          </SwipeRow>
        ))}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
