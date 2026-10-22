import { describe, expect, it } from "vitest";
import { isPushServiceUrl } from "./push";

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
