import { Collapsible } from "@base-ui/react/collapsible";
import type { IdlePrDto, ItemDto } from "@pr-peek/core";
import { ChevronRight } from "lucide-react";
import { IdlePrRow, ItemRow } from "./ItemRow";
import styles from "./ItemSection.module.css";

// A section of the list. `idle` PRs come after the items.
export function ItemSection({
  title,
  items,
  idle = [],
  open,
  onOpenChange,
}: {
  title: string;
  items: ItemDto[];
  idle?: IdlePrDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
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
          <ItemRow key={item.id} item={item} />
        ))}
        {idle.map((pr) => (
          <IdlePrRow key={pr.id} pr={pr} />
        ))}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
