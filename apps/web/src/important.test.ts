import { describe, expect, it } from "vitest";
import { markImportant } from "./important";
import { groups, idlePr, important, item, mergedPr } from "./test/fake-api";

describe("markImportant", () => {
  it("marks one PR's row important, in place", () => {
    const asked = item();
    const other = item();
    const marked = markImportant(
      groups({ review: [asked, other] }),
      asked.pr.id,
      true,
    );
    expect(marked.review.map((row) => row.id)).toEqual([asked.id, other.id]);
    expect(marked.review[0]?.pr.important).toBe(true);
    expect(marked.review[1]?.pr.important).toBe(false);
  });

  it("marks an idle PR too", () => {
    const idle = idlePr();
    const marked = markImportant(groups({ idlePrs: [idle] }), idle.id, true);
    expect(marked.idlePrs[0]?.pr.important).toBe(true);
  });

  it("unmarks it, and leaves the new dot alone", () => {
    const fresh = item({ unseen: true });
    const list = groups({
      replies: [{ ...fresh, pr: { ...fresh.pr, important: true } }],
    });
    const unmarked = markImportant(list, fresh.pr.id, false);
    expect(unmarked.replies[0]).toMatchObject({
      unseen: true,
      pr: { important: false },
    });
  });

  it("takes out the rows only the flag kept", () => {
    const merged = mergedPr();
    const flagged = important(idlePr({ group: "review" }));
    const own = important(idlePr());
    const hushed = important(idlePr({ group: "review" }));
    const list = groups({
      idlePrs: [flagged, own],
      merged: [merged],
      quiet: { items: [], idlePrs: [hushed] },
    });

    expect(markImportant(list, merged.pr.id, false).merged).toEqual([]);
    expect(markImportant(list, flagged.pr.id, false).idlePrs).toEqual([own]);
    expect(markImportant(list, hushed.pr.id, false).quiet.idlePrs).toEqual([]);
    const unmarked = markImportant(list, own.pr.id, false);
    expect(unmarked.idlePrs.map((row) => row.id)).toEqual([flagged.id, own.id]);
    expect(unmarked.idlePrs[1]?.pr.important).toBe(false);
  });
});
