import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetIosPush, startIosPush, turnOnIosPush } from "./iosPush";
import { USER_AGENTS, stubUserAgent } from "./test/install";
import { callsTo, fakeApi, json, noContent, sentBodies } from "./test/fake-api";

const TOKEN = "ab".repeat(32);
const PR = "https://github.com/acme/web-app/pull/7";

// The app's plugins, faked. Keeps each listener, so a test can fire it.
const native = vi.hoisted(() => {
  const listeners = new Map<string, (event: unknown) => void>();
  return {
    listeners,
    fire: (name: string, event: unknown) => listeners.get(name)?.(event),
    permission: { receive: "granted" },
    PushNotifications: {
      addListener: vi.fn((name: string, listener: (event: unknown) => void) => {
        listeners.set(name, listener);
        return Promise.resolve({ remove: () => listeners.delete(name) });
      }),
      checkPermissions: vi.fn(() => Promise.resolve(native.permission)),
      requestPermissions: vi.fn(() => Promise.resolve(native.permission)),
      register: vi.fn(() => Promise.resolve()),
    },
    PrPeek: { build: vi.fn(() => Promise.resolve({ sandbox: true })) },
  };
});
vi.mock("./native", () => native);

beforeEach(() => {
  native.listeners.clear();
  native.permission.receive = "granted";
  localStorage.clear();
});

describe("startIosPush", () => {
  it("registers each open, and saves the token with the server", async () => {
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
    native.PushNotifications.register.mockClear();
    await startIosPush(vi.fn());
    expect(native.PushNotifications.register).not.toHaveBeenCalled();
  });

  it("opens a tapped PR in Safari, and marks its item seen", async () => {
    const fetch = fakeApi({ "POST /api/items/seen": noContent });
    const windowOpen = vi.spyOn(window, "open").mockReturnValue(null);
    const open = vi.fn();
    await startIosPush(open);

    native.fire("pushNotificationActionPerformed", {
      notification: { data: { url: PR, itemId: "item-1" } },
    });
    expect(windowOpen).toHaveBeenCalledWith(PR, "_blank");
    expect(open).not.toHaveBeenCalled();
    expect(sentBodies(fetch, "POST /api/items/seen")).toEqual([
      { ids: ["item-1"] },
    ]);
  });

  it("opens Git Buddy's own pages in the app", async () => {
    const open = vi.fn();
    await startIosPush(open);
    native.fire("pushNotificationActionPerformed", {
      notification: { data: { url: "/" } },
    });
    expect(open).toHaveBeenCalledWith("/");
  });

  it("stops listening when stopped", async () => {
    const stop = await startIosPush(vi.fn());
    stop();
    expect(native.listeners.size).toBe(0);
  });
});

describe("turnOnIosPush", () => {
  it("asks, then registers", async () => {
    expect(await turnOnIosPush()).toBe(true);
    expect(native.PushNotifications.register).toHaveBeenCalled();
  });

  it("is false when notifications aren't allowed", async () => {
    native.permission.receive = "denied";
    native.PushNotifications.register.mockClear();
    expect(await turnOnIosPush()).toBe(false);
    expect(native.PushNotifications.register).not.toHaveBeenCalled();
  });
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

  it("does nothing on a device that never saved one, like a computer", async () => {
    const fetch = fakeApi({});
    await forgetIosPush();
    expect(fetch).not.toHaveBeenCalled();
  });
});
