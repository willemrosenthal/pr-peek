import { useState } from "react";

// Which item's sheet is open, for a list where each item opens one sheet. The last item
// opened stays in the sheet while it slides away, even once it's gone from the list.
// Keep the sheet on the page while closed, so it slides in every time.
export function useItemSheet<Item extends { id: string }>(items: Item[]) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [last, setLast] = useState<Item | null>(null);
  return {
    // The latest copy of the last item opened.
    item: items.find((item) => item.id === last?.id) ?? last,
    open: openId !== null && items.some((item) => item.id === openId),
    show: (item: Item) => {
      setLast(item);
      setOpenId(item.id);
    },
    close: () => setOpenId(null),
  };
}
