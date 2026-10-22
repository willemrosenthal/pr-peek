import type { PushSubscriptionDto } from "@pr-peek/core";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  apiError,
  callsTo,
  device,
  fakeApi,
  json,
  type Handlers,
  noContent,
  sentBodies,
  signedInApi,
} from "../../test/fake-api";
import { stubUserAgent, USER_AGENTS } from "../../test/install";
import {
  PUBLIC_KEY,
  stubPush,
  SUBSCRIPTION_KEYS,
  THIS_ENDPOINT,
} from "../../test/push";
import { renderApp } from "../../test/render";

// A server holding `devices`. Tests change the list in place to change what it returns.
function devicesApi(devices: PushSubscriptionDto[], overrides: Handlers = {}) {
  return fakeApi(
    signedInApi({
      "GET /api/push/key": () => json({ publicKey: PUBLIC_KEY }),
      "GET /api/push/subscriptions": () => json({ subscriptions: devices }),
      ...overrides,
    }),
  );
}

const turnOnButton = () =>
  screen.findByRole("button", { name: "Turn on notifications" });
const deviceList = () => screen.findByRole("list", { name: "Devices" });

describe("turning on notifications", () => {
  it("asks, subscribes, and saves this device", async () => {
    stubUserAgent(USER_AGENTS.chrome);
    const push = stubPush();
    const devices: PushSubscriptionDto[] = [];
    const fetch = devicesApi(devices, {
      "POST /api/push/subscriptions": () => {
        const saved = device({ endpoint: THIS_ENDPOINT, label: "Mac, Chrome" });
        devices.push(saved);
        return json({ subscription: saved }, 201);
      },
    });
    renderApp("/settings/devices");

    await userEvent.click(await turnOnButton());
    expect(
      await screen.findByText("Notifications are on for this device."),
    ).toBeTruthy();
    expect(push.notification.requestPermission).toHaveBeenCalledOnce();
    const [options] = push.pushManager.subscribe.mock.calls[0]!;
    expect(options.userVisibleOnly).toBe(true);
    // A VAPID public key decodes to 65 bytes.
    expect(options.applicationServerKey).toHaveLength(65);
    expect(sentBodies(fetch, "POST /api/push/subscriptions")).toEqual([
      {
        endpoint: THIS_ENDPOINT,
        keys: SUBSCRIPTION_KEYS,
        label: "Mac, Chrome",
      },
    ]);
    const list = await deviceList();
    expect(within(list).getByText(/This device/)).toBeTruthy();
    expect(localStorage.getItem("push-endpoint")).toBe(THIS_ENDPOINT);
  });

  it("stops when the user doesn't allow notifications", async () => {
    const push = stubPush({ answer: "default" });
    const fetch = devicesApi([]);
    renderApp("/settings/devices");

    await userEvent.click(await turnOnButton());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Notifications weren't allowed.",
    );
    expect(push.pushManager.subscribe).not.toHaveBeenCalled();
    expect(sentBodies(fetch, "POST /api/push/subscriptions")).toEqual([]);
  });

  it("asks for a reload when no service worker runs", async () => {
    stubPush({ worker: false });
    devicesApi([]);
    renderApp("/settings/devices");

    await userEvent.click(await turnOnButton());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Reload the page and try again.",
    );
  });

  it("says how to unblock notifications the user blocked", async () => {
    stubPush({ permission: "denied" });
    devicesApi([]);
    renderApp("/settings/devices");

    expect(
      await screen.findByText(/Notifications are blocked for pr-peek/),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Turn on notifications" }),
    ).toBe(null);
  });

  it("offers it again when the server dropped this device", async () => {
    stubPush({ subscribed: THIS_ENDPOINT });
    devicesApi([]);
    renderApp("/settings/devices");
    expect(await turnOnButton()).toBeTruthy();
  });

  it("says when push is off on the server", async () => {
    stubPush();
    devicesApi([], {
      "GET /api/push/key": () =>
        apiError(503, "push_off", "Push notifications aren't set up"),
    });
    renderApp("/settings/devices");
    expect(
      await screen.findByText(
        "Notifications aren't set up on this server yet.",
      ),
    ).toBeTruthy();
  });

  it("shows the install steps on an iPhone outside the Home Screen app", async () => {
    stubUserAgent(USER_AGENTS.iphone);
    devicesApi([]);
    renderApp("/settings/devices");
    expect(
      await screen.findByText(
        "On iPhone, notifications only work in the Home Screen app.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Tap Add to Home Screen, then Add.")).toBeTruthy();
  });

  it("says when the browser can't get notifications", async () => {
    devicesApi([]);
    renderApp("/settings/devices");
    expect(
      await screen.findByText("This browser can't get notifications."),
    ).toBeTruthy();
  });
});

describe("checking this device on open", () => {
  const OLD_ENDPOINT = "https://fcm.googleapis.com/fcm/send/old";

  it("moves the device when the browser changed its subscription", async () => {
    stubPush({ subscribed: THIS_ENDPOINT });
    localStorage.setItem("push-endpoint", OLD_ENDPOINT);
    const devices = [device({ endpoint: OLD_ENDPOINT, label: "Mac" })];
    const mac = devices[0]!;
    const fetch = devicesApi(devices, {
      [`PATCH /api/push/subscriptions/${mac.id}`]: () => {
        mac.endpoint = THIS_ENDPOINT;
        return json({ subscription: mac });
      },
    });
    renderApp("/settings/devices");

    expect(
      await screen.findByText("Notifications are on for this device."),
    ).toBeTruthy();
    expect(
      sentBodies(fetch, `PATCH /api/push/subscriptions/${mac.id}`),
    ).toEqual([
      { subscription: { endpoint: THIS_ENDPOINT, keys: SUBSCRIPTION_KEYS } },
    ]);
    expect(localStorage.getItem("push-endpoint")).toBe(THIS_ENDPOINT);
  });

  it("leaves a device removed from another device removed", async () => {
    stubPush({ subscribed: THIS_ENDPOINT });
    localStorage.setItem("push-endpoint", OLD_ENDPOINT);
    const fetch = devicesApi([]);
    renderApp("/settings/devices");

    expect(await turnOnButton()).toBeTruthy();
    // The list, and the check. Neither adds the device back.
    await waitFor(() =>
      expect(callsTo(fetch, "/api/push/subscriptions")).toHaveLength(2),
    );
    expect(sentBodies(fetch, "POST /api/push/subscriptions")).toEqual([]);
  });

  it("remembers a device saved before it kept track", async () => {
    stubPush({ subscribed: THIS_ENDPOINT });
    devicesApi([device({ endpoint: THIS_ENDPOINT })]);
    renderApp("/settings/devices");

    await waitFor(() =>
      expect(localStorage.getItem("push-endpoint")).toBe(THIS_ENDPOINT),
    );
  });
});

describe("the device list", () => {
  it("lists devices with when each last got a notification", async () => {
    devicesApi([
      device({ label: "iPhone", lastSuccessAt: new Date().toISOString() }),
      device({ label: "Mac, Safari" }),
    ]);
    renderApp("/settings/devices");

    const list = await deviceList();
    expect(within(list).getByText("Last sent just now.")).toBeTruthy();
    expect(within(list).getByText("Nothing sent yet.")).toBeTruthy();
  });

  it("says when there are none", async () => {
    devicesApi([]);
    renderApp("/settings/devices");
    expect(
      await screen.findByText("No devices get notifications yet."),
    ).toBeTruthy();
  });

  it("sends a test", async () => {
    const phone = device({ label: "iPhone" });
    const fetch = devicesApi([phone], {
      [`POST /api/push/subscriptions/${phone.id}/test`]: () => {
        phone.lastSuccessAt = new Date().toISOString();
        return json({ subscription: phone });
      },
    });
    renderApp("/settings/devices");

    await userEvent.click(
      await screen.findByRole("button", { name: "Send a test to iPhone" }),
    );
    expect(await screen.findByText("Last sent just now.")).toBeTruthy();
    expect(
      callsTo(fetch, `/api/push/subscriptions/${phone.id}/test`),
    ).toHaveLength(1);
  });

  it("drops a device the test found gone", async () => {
    const devices = [device({ label: "iPhone" })];
    const [phone] = devices;
    devicesApi(devices, {
      [`POST /api/push/subscriptions/${phone!.id}/test`]: () => {
        devices.pop();
        return apiError(410, "device_gone", "This device was removed");
      },
    });
    renderApp("/settings/devices");

    await userEvent.click(
      await screen.findByRole("button", { name: "Send a test to iPhone" }),
    );
    expect(
      await screen.findByText("No devices get notifications yet."),
    ).toBeTruthy();
  });

  it("chooses which notifications a device gets", async () => {
    const phone = device({ label: "iPhone" });
    const fetch = devicesApi([phone], {
      [`PATCH /api/push/subscriptions/${phone.id}`]: () => {
        phone.minSeverity = "high";
        return json({ subscription: phone });
      },
    });
    renderApp("/settings/devices");

    const select = await screen.findByLabelText("Notifications on iPhone");
    await userEvent.selectOptions(select, "High only");
    expect(
      sentBodies(fetch, `PATCH /api/push/subscriptions/${phone.id}`),
    ).toEqual([{ minSeverity: "high" }]);
    await waitFor(() => expect(select).toHaveProperty("disabled", false));
    expect(select).toHaveProperty("value", "high");
  });

  it("renames a device when the name box loses focus", async () => {
    const ipad = device({ label: "Mac, Safari" });
    const fetch = devicesApi([ipad], {
      [`PATCH /api/push/subscriptions/${ipad.id}`]: () => {
        ipad.label = "iPad";
        return json({ subscription: ipad });
      },
    });
    renderApp("/settings/devices");

    const name = await screen.findByLabelText("Name for Mac, Safari");
    await userEvent.clear(name);
    await userEvent.type(name, "  iPad ");
    await userEvent.tab();
    expect(await screen.findByLabelText("Name for iPad")).toBeTruthy();
    expect(
      sentBodies(fetch, `PATCH /api/push/subscriptions/${ipad.id}`),
    ).toEqual([{ label: "iPad" }]);
  });

  it("puts back the old name when the new one is blank or fails to save", async () => {
    const phone = device({ label: "iPhone" });
    const fetch = devicesApi([phone], {
      [`PATCH /api/push/subscriptions/${phone.id}`]: () =>
        apiError(400, "invalid_input", "Too long"),
    });
    renderApp("/settings/devices");

    const name = await screen.findByLabelText("Name for iPhone");
    await userEvent.clear(name);
    await userEvent.tab();
    expect(name).toHaveProperty("value", "iPhone");
    expect(
      sentBodies(fetch, `PATCH /api/push/subscriptions/${phone.id}`),
    ).toEqual([]);

    await userEvent.type(name, " 2");
    await userEvent.tab();
    expect((await screen.findByRole("alert")).textContent).toBe("Too long");
    expect(name).toHaveProperty("value", "iPhone");
  });

  it("removes another device", async () => {
    const push = stubPush({ subscribed: THIS_ENDPOINT });
    const devices = [
      device({ endpoint: THIS_ENDPOINT, label: "Mac" }),
      device({ label: "iPhone" }),
    ];
    const phone = devices[1]!;
    devicesApi(devices, {
      [`DELETE /api/push/subscriptions/${phone.id}`]: () => {
        devices.pop();
        return noContent();
      },
    });
    renderApp("/settings/devices");

    await userEvent.click(
      await screen.findByRole("button", { name: "Remove iPhone" }),
    );
    await screen.findByText("Notifications are on for this device.");
    expect(screen.queryByRole("button", { name: "Remove iPhone" })).toBe(null);
    expect(push.subscription()).not.toBe(null);
  });

  it("unsubscribes this browser when removing this device", async () => {
    const push = stubPush({ subscribed: THIS_ENDPOINT });
    const devices = [device({ endpoint: THIS_ENDPOINT, label: "Mac" })];
    devicesApi(devices, {
      [`DELETE /api/push/subscriptions/${devices[0]!.id}`]: () => {
        devices.pop();
        return noContent();
      },
    });
    renderApp("/settings/devices");

    const list = await deviceList();
    expect(within(list).getByText(/This device/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove Mac" }));
    expect(await turnOnButton()).toBeTruthy();
    expect(push.subscription()).toBe(null);
    expect(localStorage.getItem("push-endpoint")).toBe(null);
  });
});
