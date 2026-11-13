import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetIosPush,
  iosPushStatus,
  openIosSettings,
  startIosPush,
  turnOnIosPush,
} from "./iosPush";
import { USER_AGENTS, stubUserAgent } from "./test/install";
import * as native from "./test/native";
import {
  apiError,
  callsTo,
  fakeApi,
  json,
  noContent,
  offline,
  sentBodies,
} from "./test/fake-api";

const TOKEN = "ab".repeat(32);
const PR = "https://github.com/acme/web-app/pull/7";

vi.mock("./native", () => import("./test/native"));

beforeEach(() => {
  native.resetNative();
  localStorage.clear();
});

describe("startIosPush", () => {
  it("registers when allowed, and saves the token with the server", async () => {
    stubUserAgent(USER_AGENTS.iphone);
    const fetch = fakeApi({
      "POST /api/apple-devices": () => json({ device: {} }, 201),
    });
    await startIosPush(vi.fn());
    expect(native.PushNotifications.register).toHaveBeenCalled();

    native.fire("registration", { value: TOKEN });
    await vi.waitFor(() =>
      expect(sentBodies(fetch, "POST /api/apple-devices")).toEqual([
        { token: TOKEN, label: "iPhone", sandbox: true },
      ]),
    );
  });

  it("doesn't register before notifications are allowed", async () => {
    native.permission.receive = "prompt";
    await startIosPush(vi.fn());
    expect(native.PushNotifications.register).not.toHaveBeenCalled();
  });

  it("opens a tapped PR's preview in the app, and marks its item seen", async () => {
    const fetch = fakeApi({ "POST /api/items/seen": noContent });
    const windowOpen = vi.spyOn(window, "open").mockReturnValue(null);
    const open = vi.fn();
    await startIosPush(open);

    native.fire("pushNotificationActionPerformed", {
      notification: { data: { url: PR, prId: "pr-1", itemId: "item-1" } },
    });
    expect(open).toHaveBeenCalledWith("/?pr=pr-1");
    expect(windowOpen).not.toHaveBeenCalled();
    expect(sentBodies(fetch, "POST /api/items/seen")).toEqual([
      { ids: ["item-1"] },
    ]);
  });

  // Like from a server that doesn't send `prId` yet.
  it("opens a tapped PR without its ID in Safari", async () => {
    const windowOpen = vi.spyOn(window, "open").mockReturnValue(null);
    const open = vi.fn();
    await startIosPush(open);

    native.fire("pushNotificationActionPerformed", {
      notification: { data: { url: PR } },
    });
    expect(windowOpen).toHaveBeenCalledWith(PR, "_blank");
    expect(open).not.toHaveBeenCalled();
  });

  it("opens Git Buddy's own pages in the app", async () => {
    const open = vi.fn();
    await startIosPush(open);
    native.fire("pushNotificationActionPerformed", {
      notification: { data: { url: "/" } },
    });
    expect(open).toHaveBeenCalledWith("/");
  });

  it("can still be stopped when registering fails", async () => {
    native.PushNotifications.register.mockRejectedValueOnce(new Error("no"));
    const stop = await startIosPush(vi.fn());
    stop();
    expect(native.listenerCount()).toBe(0);
  });

  it("stops listening when stopped", async () => {
    const stop = await startIosPush(vi.fn());
    stop();
    expect(native.listenerCount()).toBe(0);
  });
});

describe("turnOnIosPush", () => {
  it("asks, then registers", async () => {
    await turnOnIosPush();
    expect(native.PushNotifications.register).toHaveBeenCalled();
  });

  it("doesn't register when notifications aren't allowed", async () => {
    native.permission.receive = "denied";
    await turnOnIosPush();
    expect(native.PushNotifications.register).not.toHaveBeenCalled();
  });
});

describe("iosPushStatus", () => {
  it.each([
    ["granted", "on"],
    ["denied", "blocked"],
    ["prompt", "off"],
    ["prompt-with-rationale", "off"],
  ])("reads %s as %s", async (receive, status) => {
    native.permission.receive = receive;
    expect(await iosPushStatus()).toBe(status);
  });
});

it("opens iPhone Settings", async () => {
  await openIosSettings();
  expect(native.PrPeek.openSettings).toHaveBeenCalled();
});

describe("forgetIosPush", () => {
  it("removes the saved token from the server", async () => {
    const fetch = fakeApi({
      "POST /api/apple-devices": () => json({ device: {} }, 201),
      [`DELETE /api/apple-devices/${TOKEN}`]: noContent,
    });
    await startIosPush(vi.fn());
    native.fire("registration", { value: TOKEN });
    await vi.waitFor(() =>
      expect(callsTo(fetch, "/api/apple-devices")).toHaveLength(1),
    );

    await forgetIosPush();
    expect(callsTo(fetch, `/api/apple-devices/${TOKEN}`)).toHaveLength(1);
    // Only once: it's forgotten.
    await forgetIosPush();
    expect(callsTo(fetch, `/api/apple-devices/${TOKEN}`)).toHaveLength(1);
  });

  it("keeps the token when the server can't be reached, to try again", async () => {
    localStorage.setItem("pr-peek:apple-token", TOKEN);
    const fetch = fakeApi({ [`DELETE /api/apple-devices/${TOKEN}`]: offline });
    await expect(forgetIosPush()).rejects.toThrow();
    await expect(forgetIosPush()).rejects.toThrow();
    expect(callsTo(fetch, `/api/apple-devices/${TOKEN}`)).toHaveLength(2);
  });

  it("forgets a token the server no longer has", async () => {
    localStorage.setItem("pr-peek:apple-token", TOKEN);
    fakeApi({
      [`DELETE /api/apple-devices/${TOKEN}`]: () =>
        apiError(404, "not_found", "Device not found"),
    });
    await forgetIosPush();
    expect(localStorage.getItem("pr-peek:apple-token")).toBeNull();
  });

  it("does nothing on a device that never saved one, like a computer", async () => {
    const fetch = fakeApi({});
    await forgetIosPush();
    expect(fetch).not.toHaveBeenCalled();
  });
});
