import { ITEM_GROUPS, type ItemsResponse } from "@pr-peek/core";

// The list with one PR moved into or out of the Quiet section, shown until the server's
// list arrives. A quieted PR goes to the top of Quiet. A PR brought back goes to the end
// of its section.
export function moveQuiet(
  list: ItemsResponse,
  prId: string,
  quiet: boolean,
): ItemsResponse {
  const isPr = (row: { pr: { id: string } }) => row.pr.id === prId;
  const without = <T extends { pr: { id: string } }>(rows: T[]) =>
    rows.filter((row) => !isPr(row));

  if (quiet) {
    const items = [...list.review, ...list.replies, ...list.mine].filter(isPr);
    return {
      review: without(list.review),
      replies: without(list.replies),
      mine: without(list.mine),
      idlePrs: without(list.idlePrs),
      quiet: {
        items: [...items, ...list.quiet.items],
        idlePrs: [...list.idlePrs.filter(isPr), ...list.quiet.idlePrs],
      },
    };
  }

  const groups = {
    review: [...list.review],
    replies: [...list.replies],
    mine: [...list.mine],
  };
  for (const item of list.quiet.items.filter(isPr)) {
    groups[ITEM_GROUPS[item.kind]].push(item);
  }
  return {
    ...groups,
    idlePrs: [...list.idlePrs, ...list.quiet.idlePrs.filter(isPr)],
    quiet: {
      items: without(list.quiet.items),
      idlePrs: without(list.quiet.idlePrs),
    },
  };
}
