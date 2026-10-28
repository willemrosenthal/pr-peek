import type { ItemDto, ItemsResponse } from "@pr-peek/core";

// The list with one PR marked important, or not, shown until the server's list arrives.
export function markImportant(
  list: ItemsResponse,
  prId: string,
  important: boolean,
): ItemsResponse {
  const mark = <Row extends { pr: ItemDto["pr"] }>(rows: Row[]) =>
    rows.map((row) =>
      row.pr.id === prId ? { ...row, pr: { ...row.pr, important } } : row,
    );
  return {
    review: mark(list.review),
    replies: mark(list.replies),
    assigned: mark(list.assigned),
    mine: mark(list.mine),
    idlePrs: mark(list.idlePrs),
    merged: mark(list.merged),
    quiet: { items: mark(list.quiet.items), idlePrs: mark(list.quiet.idlePrs) },
  };
}
