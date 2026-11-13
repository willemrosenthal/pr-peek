import { describe, expect, it, onTestFinished } from "vitest";
import {
  callsTo,
  device,
  fakeApi,
  json,
  noContent,
  offline,
} from "./test/fake-api";
import { stubDisplayMode, stubUserAgent, USER_AGENTS } from "./test/install";
import { stubPush, THIS_ENDPOINT } from "./test/push";
import { deviceLabel, forgetWebPush, onMac, pushSupport } from "./push";

describe("deviceLabel", () => {
  it.each([
    [USER_AGENTS.iphone, "iPhone"],
    [USER_AGENTS.chrome, "Mac, Chrome"],
    [USER_AGENTS.macSafari, "Mac, Safari"],
    [USER_AGENTS.firefox, "Mac, Firefox"],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      "Windows, Edge",
    ],
    [
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
      "Android, Chrome",
    ],
    ["Something new", "Browser"],
  ])("names %s as %s", (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });
});

describe("onMac", () => {
  it("is true on a Mac, but not an iPad or iPhone", () => {
    expect(onMac(USER_AGENTS.macSafari)).toBe(true);
    expect(onMac(USER_AGENTS.iphone)).toBe(false);
    // iPads in desktop mode say they're Macs, but have a touch screen.
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 5,
    });
    onTestFinished(() => {
      delete (navigator as { maxTouchPoints?: number }).maxTouchPoints;
    });
    expect(onMac(USER_AGENTS.macSafari)).toBe(false);
  });
});

describe("pushSupport", () => {
  it("needs the Home Screen app on an iPhone", () => {
    stubUserAgent(USER_AGENTS.iphone);
    expect(pushSupport()).toBe("needs-install");
  });

  it("works in the iPhone's Home Screen app", () => {
    stubUserAgent(USER_AGENTS.iphone);
    stubDisplayMode({ standalone: true });
    stubPush();
    expect(pushSupport()).toBe("supported");
  });

  it("is missing in browsers without push", () => {
    expect(pushSupport()).toBe("unsupported");
  });
});

describe("forgetWebPush", () => {
  it("removes this browser's device, and unsubscribes it", async () => {
    const push = stubPush({ subscribed: THIS_ENDPOINT });
    const mine = device({ endpoint: THIS_ENDPOINT });
    const fetch = fakeApi({
      "GET /api/push/subscriptions": () =>
        json({ subscriptions: [device(), mine] }),
      [`DELETE /api/push/subscriptions/${mine.id}`]: noContent,
    });
    await forgetWebPush();
    expect(callsTo(fetch, `/api/push/subscriptions/${mine.id}`)).toHaveLength(
      1,
    );
    expect(push.subscription()).toBeNull();
  });

  it("still unsubscribes when the server no longer has the device", async () => {
    const push = stubPush({ subscribed: THIS_ENDPOINT });
    fakeApi({
      "GET /api/push/subscriptions": () => json({ subscriptions: [device()] }),
    });
    await forgetWebPush();
    expect(push.subscription()).toBeNull();
  });

  it("keeps the subscription when the server can't be reached, to try again", async () => {
    const push = stubPush({ subscribed: THIS_ENDPOINT });
    fakeApi({ "GET /api/push/subscriptions": offline });
    await expect(forgetWebPush()).rejects.toThrow();
    expect(push.subscription()?.endpoint).toBe(THIS_ENDPOINT);
  });

  it("does nothing in a browser that never turned push on", async () => {
    stubPush();
    const fetch = fakeApi({});
    await forgetWebPush();
    expect(fetch).not.toHaveBeenCalled();
  });
});
