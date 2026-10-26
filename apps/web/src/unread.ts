import type { IdlePrDto, ItemDto, ItemsResponse } from "@pr-peek/core";

// Whether a row shows the dot: something new on it, or the user marked it unread.
export const showsDot = (pr: ItemDto["pr"], item: ItemDto | null) =>
  pr.markedUnread || (item?.unseen ?? false);

// The list with one PR marked unread, or read, shown until the server's list arrives.
// Marking it read also clears the dot for something new on it, like the server does.
export function markUnread(
  list: ItemsResponse,
  prId: string,
  unread: boolean,
): ItemsResponse {
  const mark = (pr: ItemDto["pr"]) =>
    pr.id === prId ? { ...pr, markedUnread: unread } : pr;
  const items = (rows: ItemDto[]) =>
    rows.map((row) =>
      row.pr.id === prId
        ? { ...row, unseen: unread && row.unseen, pr: mark(row.pr) }
        : row,
    );
  const idle = (rows: IdlePrDto[]) =>
    rows.map((row) => ({ ...row, pr: mark(row.pr) }));

  return {
    review: items(list.review),
    replies: items(list.replies),
    mine: items(list.mine),
    idlePrs: idle(list.idlePrs),
    quiet: {
      items: items(list.quiet.items),
      idlePrs: idle(list.quiet.idlePrs),
    },
  };
}
