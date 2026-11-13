import { describe, expect, it } from "vitest";
import { findPreview } from "./findPreview";
import { groups, idlePr, item, mergedPr } from "./test/fake-api";

describe("findPreview", () => {
  it("finds a PR's item in its section", () => {
    const replied = item();
    expect(
      findPreview(groups({ replies: [item(), replied] }), replied.pr.id),
    ).toEqual({ pr: replied.pr, item: replied, quiet: false });
  });

  it("finds a quiet item", () => {
    const quieted = item();
    const list = groups({ quiet: { items: [quieted], idlePrs: [] } });
    expect(findPreview(list, quieted.pr.id)).toEqual({
      pr: quieted.pr,
      item: quieted,
      quiet: true,
    });
  });

  it("finds idle PRs, in Watching too", () => {
    const watched = idlePr({ group: "watching" });
    expect(findPreview(groups({ idlePrs: [watched] }), watched.pr.id)).toEqual({
      pr: watched.pr,
      item: null,
      quiet: false,
      watching: true,
    });
  });

  it("finds merged PRs", () => {
    const merged = mergedPr({ group: "mine" });
    expect(findPreview(groups({ merged: [merged] }), merged.pr.id)).toEqual({
      pr: merged.pr,
      item: null,
      quiet: false,
      merged: true,
      watching: false,
    });
  });

  it("finds quiet idle PRs", () => {
    const idle = idlePr();
    const list = groups({ quiet: { items: [], idlePrs: [idle] } });
    expect(findPreview(list, idle.pr.id)).toEqual({
      pr: idle.pr,
      item: null,
      quiet: true,
    });
  });

  it("is null for a PR not on the list", () => {
    expect(findPreview(groups({ review: [item()] }), "gone")).toBe(null);
  });
});
