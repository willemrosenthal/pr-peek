import { Collapsible } from "@base-ui/react/collapsible";
import type { IdlePrDto, ItemDto } from "@pr-peek/core";
import { ChevronRight } from "lucide-react";
import { useSetQuiet } from "../queries";
import { IdlePrRow, ItemRow } from "./ItemRow";
import styles from "./ItemSection.module.css";
import { SwipeRow } from "./SwipeRow";

// A section of the list. `idle` PRs come after the items. Rows in the `quiet` section
// are one line, and swiping one brings it back.
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
  const toggle = (prId: string) => () =>
    setQuiet.mutate({ prId, quiet: !quiet });
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
          <SwipeRow key={item.id} quiet={quiet} onToggle={toggle(item.pr.id)}>
            <ItemRow item={item} quiet={quiet} showAuthor={showAuthors} />
          </SwipeRow>
        ))}
        {idle.map((pr) => (
          <SwipeRow key={pr.id} quiet={quiet} onToggle={toggle(pr.id)}>
            <IdlePrRow pr={pr} quiet={quiet} showAuthor={showAuthors} />
          </SwipeRow>
        ))}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
