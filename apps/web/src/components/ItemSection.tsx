import { Collapsible } from "@base-ui/react/collapsible";
import type { ItemDto } from "@pr-peek/core";
import { ChevronRight } from "lucide-react";
import { ItemRow } from "./ItemRow";
import styles from "./ItemSection.module.css";

export function ItemSection({
  title,
  items,
  open,
  onOpenChange,
}: {
  title: string;
  items: ItemDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange}>
      <h2 className={styles.heading}>
        <Collapsible.Trigger className={styles.trigger}>
          <ChevronRight size={10} className={styles.chevron} />
          <span className={styles.title}>{title}</span>
          <span>{items.length}</span>
        </Collapsible.Trigger>
      </h2>
      <Collapsible.Panel>
        {items.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
