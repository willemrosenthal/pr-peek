import { describe, expect, it } from "vitest";
import {
  githubAvatarUrl,
  isPushServiceUrl,
  PUSH_KINDS,
  pushKindOf,
} from "./push";

describe("isPushServiceUrl", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("allows %s", (url) => {
    expect(isPushServiceUrl(url)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://localhost:5432/",
    "https://169.254.169.254/latest",
    "https://evil.com/push.apple.com",
    "https://notpush.apple.com/abc",
    "not a url",
  ])("refuses %s", (url) => {
    expect(isPushServiceUrl(url)).toBe(false);
  });
});

describe("pushKindOf", () => {
  it("gives each review its own tile", () => {
    expect(pushKindOf("reviewed", "approved")).toBe("approved");
    expect(pushKindOf("reviewed", "changes_requested")).toBe(
      "changes_requested",
    );
    // A review saved before its state was.
    expect(pushKindOf("reviewed", null)).toBe("approved");
  });

  it("uses the item's kind for the rest", () => {
    expect(pushKindOf("mention", null)).toBe("mention");
  });

  it("lists every kind once, with no reviewed", () => {
    expect(new Set(PUSH_KINDS).size).toBe(PUSH_KINDS.length);
    expect(PUSH_KINDS).not.toContain("reviewed");
    expect(PUSH_KINDS).toContain("merged");
  });
});

it("links to a GitHub picture at a size, with the login made safe", () => {
  expect(githubAvatarUrl("jlee[bot]", 120)).toBe(
    "https://avatars.githubusercontent.com/jlee%5Bbot%5D?s=120",
  );
});
