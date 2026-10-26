import { describe, expect, it } from "vitest";
import { groups, idlePr, item } from "./test/fake-api";
import { markUnread } from "./unread";

describe("markUnread", () => {
  it("marks one PR's row unread, in place", () => {
    const asked = item();
    const other = item();
    const marked = markUnread(
      groups({ review: [asked, other] }),
      asked.pr.id,
      true,
    );
    expect(marked.review.map((row) => row.id)).toEqual([asked.id, other.id]);
    expect(marked.review[0]?.pr.markedUnread).toBe(true);
    expect(marked.review[1]?.pr.markedUnread).toBe(false);
  });

  it("marks an idle PR too", () => {
    const idle = idlePr();
    const marked = markUnread(groups({ idlePrs: [idle] }), idle.id, true);
    expect(marked.idlePrs[0]?.pr.markedUnread).toBe(true);
  });

  it("clears the mark and the new dot when marked read", () => {
    const fresh = item({ unseen: true });
    const marked = { ...fresh, pr: { ...fresh.pr, markedUnread: true } };
    const other = item({ unseen: true });

    const read = markUnread(
      groups({ replies: [marked, other] }),
      fresh.pr.id,
      false,
    );
    expect(read.replies[0]).toMatchObject({
      unseen: false,
      pr: { markedUnread: false },
    });
    expect(read.replies[1]?.unseen).toBe(true);
  });

  it("keeps the new dot when marked unread", () => {
    const fresh = item({ unseen: true });
    const marked = markUnread(groups({ review: [fresh] }), fresh.pr.id, true);
    expect(marked.review[0]?.unseen).toBe(true);
  });
});
