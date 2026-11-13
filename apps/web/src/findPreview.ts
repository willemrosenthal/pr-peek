import type { ItemDto, ItemsResponse } from "@pr-peek/core";
import type { PreviewTarget } from "./components/PrPreview";
import { SECTIONS } from "./sections";

// The preview for the PR `prId`, as its row on the list opens it. Null when it's not on
// the list, like once its item is done.
export function findPreview(
  list: ItemsResponse,
  prId: string,
): PreviewTarget | null {
  const { quiet } = list;
  const groups: [ItemDto[], boolean][] = [
    ...SECTIONS.map(({ group }): [ItemDto[], boolean] => [
      group === "watching" ? [] : list[group],
      false,
    ]),
    [quiet.items, true],
  ];
  for (const [items, isQuiet] of groups) {
    const item = items.find((i) => i.pr.id === prId);
    if (item) return { pr: item.pr, item, quiet: isQuiet };
  }
  const idle = list.idlePrs.find((p) => p.pr.id === prId);
  if (idle) {
    const watching = idle.group === "watching";
    return { pr: idle.pr, item: null, quiet: false, watching };
  }
  const merged = list.merged.find((p) => p.pr.id === prId);
  if (merged) {
    const watching = merged.group === "watching";
    return { pr: merged.pr, item: null, quiet: false, merged: true, watching };
  }
  const quietIdle = quiet.idlePrs.find((p) => p.pr.id === prId);
  return quietIdle ? { pr: quietIdle.pr, item: null, quiet: true } : null;
}
