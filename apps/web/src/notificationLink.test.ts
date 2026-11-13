import { describe, expect, it } from "vitest";
import { notificationLink } from "./notificationLink";

describe("notificationLink", () => {
  it("opens the PR's preview in the app", () => {
    expect(
      notificationLink({ url: "https://github.com/a/b/pull/1", prId: "pr-1" }),
    ).toBe("/?pr=pr-1");
  });

  it("opens the link when it's about no PR, like the morning summary", () => {
    expect(notificationLink({ url: "/" })).toBe("/");
  });
});
