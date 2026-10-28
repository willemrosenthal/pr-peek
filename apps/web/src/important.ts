import type { IdlePrDto, ItemDto, ItemsResponse } from "@pr-peek/core";

// The list with one PR marked important, or not, shown until the server's list arrives.
// Unmarked, a merged PR leaves, and so does an idle one that isn't the user's: only the
// flag kept them.
export function markImportant(
  list: ItemsResponse,
  prId: string,
  important: boolean,
): ItemsResponse {
  const mark = <Row extends { pr: ItemDto["pr"] }>(rows: Row[]) =>
    rows.map((row) =>
      row.pr.id === prId ? { ...row, pr: { ...row.pr, important } } : row,
    );
  const keptIdle = (rows: IdlePrDto[]) =>
    important
      ? rows
      : rows.filter((row) => row.pr.id !== prId || row.group === "mine");
  return {
    review: mark(list.review),
    replies: mark(list.replies),
    assigned: mark(list.assigned),
    mine: mark(list.mine),
    idlePrs: mark(keptIdle(list.idlePrs)),
    // Merged rows are always marked.
    merged: important
      ? list.merged
      : list.merged.filter((row) => row.pr.id !== prId),
    quiet: {
      items: mark(list.quiet.items),
      idlePrs: mark(keptIdle(list.quiet.idlePrs)),
    },
  };
}
