import { describe, expect, it, onTestFinished } from "vitest";
import { stubDisplayMode, stubUserAgent, USER_AGENTS } from "./test/install";
import { stubPush, THIS_ENDPOINT } from "./test/push";
import {
  deviceLabel,
  onMac,
  pauseWebPush,
  pushSupport,
  resumeWebPush,
} from "./push";
import {
  apiError,
  device,
  fakeApi,
  json,
  offline,
  sentBodies,
} from "./test/fake-api";

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

describe("resumeWebPush", () => {
  const USER = "user-1";
  const saved = () =>
    json({ subscription: device({ endpoint: THIS_ENDPOINT }) }, 201);

  it("saves the device again for the user who signed out", async () => {
    const push = stubPush({ subscribed: THIS_ENDPOINT });
    pauseWebPush(USER);
    const fetch = fakeApi({ "POST /api/push/subscriptions": saved });

    expect(await resumeWebPush(USER)).toBe(true);
    expect(sentBodies(fetch, "POST /api/push/subscriptions")).toEqual([
      expect.objectContaining({ endpoint: THIS_ENDPOINT }),
    ]);
    expect(push.subscription()?.endpoint).toBe(THIS_ENDPOINT);
    // Only once.
    expect(await resumeWebPush(USER)).toBe(false);
  });

  it("drops it when someone else signs in", async () => {
    const push = stubPush({ subscribed: THIS_ENDPOINT });
    pauseWebPush(USER);
    const fetch = fakeApi({});

    expect(await resumeWebPush("someone-else")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(push.subscription()).toBeNull();
  });

  it("tries again on the next open when the server can't be reached", async () => {
    stubPush({ subscribed: THIS_ENDPOINT });
    pauseWebPush(USER);
    fakeApi({ "POST /api/push/subscriptions": offline });
    await expect(resumeWebPush(USER)).rejects.toThrow();

    fakeApi({ "POST /api/push/subscriptions": saved });
    expect(await resumeWebPush(USER)).toBe(true);
  });

  it("stays off when the server says no", async () => {
    stubPush({ subscribed: THIS_ENDPOINT });
    pauseWebPush(USER);
    fakeApi({
      "POST /api/push/subscriptions": () =>
        apiError(429, "too_many", "Too many devices"),
    });
    await expect(resumeWebPush(USER)).rejects.toThrow();
    expect(await resumeWebPush(USER)).toBe(false);
  });

  it("does nothing when nothing was paused", async () => {
    stubPush({ subscribed: THIS_ENDPOINT });
    const fetch = fakeApi({});
    expect(await resumeWebPush(USER)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
