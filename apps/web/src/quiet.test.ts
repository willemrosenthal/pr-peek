import { describe, expect, it } from "vitest";
import { moveQuiet } from "./quiet";
import { groups, idlePr, item } from "./test/fake-api";

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe("moveQuiet", () => {
  it("moves a PR's row to the top of Quiet", () => {
    const asked = item();
    const other = item();
    const hushed = item({ kind: "reply" });
    const list = groups({
      review: [asked, other],
      quiet: { items: [hushed], idlePrs: [] },
    });

    const moved = moveQuiet(list, asked.pr.id, true);
    expect(ids(moved.review)).toEqual([other.id]);
    expect(ids(moved.quiet.items)).toEqual([asked.id, hushed.id]);
  });

  it("moves an idle PR too", () => {
    const idle = idlePr();
    const moved = moveQuiet(groups({ idlePrs: [idle] }), idle.id, true);
    expect(moved.idlePrs).toEqual([]);
    expect(ids(moved.quiet.idlePrs)).toEqual([idle.id]);
  });

  it("brings a PR back to the end of its section", () => {
    const mine = item({ kind: "reviewed" });
    const back = item({ kind: "check_failed" });
    const idle = idlePr();
    const list = groups({
      mine: [mine],
      quiet: { items: [back], idlePrs: [idle] },
    });

    const withItem = moveQuiet(list, back.pr.id, false);
    expect(ids(withItem.mine)).toEqual([mine.id, back.id]);
    expect(withItem.quiet.items).toEqual([]);

    const withIdle = moveQuiet(list, idle.id, false);
    expect(ids(withIdle.idlePrs)).toEqual([idle.id]);
    expect(withIdle.quiet.idlePrs).toEqual([]);
  });
});
