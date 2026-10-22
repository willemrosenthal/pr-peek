import { describe, expect, it } from "vitest";
import { rules } from "./index";

describe("rules", () => {
  it("has one rule per item kind", () => {
    expect(rules.map((rule) => rule.id).sort()).toEqual([
      "check_failed",
      "commented",
      "re_requested",
      "reply",
      "review_requested",
      "reviewed",
    ]);
  });
});
