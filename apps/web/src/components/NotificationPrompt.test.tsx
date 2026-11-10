import type { PushSubscriptionDto } from "@pr-peek/core";
import { cleanup, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it } from "vitest";
import {
  apiError,
  device,
  fakeApi,
  json,
  listApi,
  sentBodies,
  type Handlers,
} from "../test/fake-api";
import { stubDisplayMode, stubUserAgent, USER_AGENTS } from "../test/install";
import {
  PUBLIC_KEY,
  stubPush,
  SUBSCRIPTION_KEYS,
  THIS_ENDPOINT,
} from "../test/push";
import { renderApp } from "../test/render";

// The list in the installed app, with a server holding `devices`. Each device takes
// changes, like the one-time "on a Mac" fill on open.
function installedApp(
  devices: PushSubscriptionDto[],
  overrides: Handlers = {},
) {
  stubDisplayMode({ standalone: true });
  const updates = Object.fromEntries(
    devices.map((saved) => [
      `PATCH /api/push/subscriptions/${saved.id}`,
      () => json({ subscription: saved }),
    ]),
  );
  return fakeApi(
    listApi({
      "GET /api/push/key": () => json({ publicKey: PUBLIC_KEY }),
      "GET /api/push/subscriptions": () => json({ subscriptions: devices }),
      ...updates,
      ...overrides,
    }),
  );
}

const turnOnButton = () =>
  screen.findByRole("button", { name: "Turn on notifications" });
const prompt = () => screen.queryByRole("region", { name: "Notifications" });
// The list loaded, so anything that would show has.
const listShown = () => screen.findByText("Nothing needs you right now");

it("asks, subscribes, saves this device, and goes away", async () => {
  stubUserAgent(USER_AGENTS.chrome);
  const push = stubPush();
  const devices: PushSubscriptionDto[] = [];
  const fetch = installedApp(devices, {
    "POST /api/push/subscriptions": () => {
      const saved = device({ endpoint: THIS_ENDPOINT, label: "Mac, Chrome" });
      devices.push(saved);
      return json({ subscription: saved }, 201);
    },
  });
  renderApp("/");

  await userEvent.click(await turnOnButton());
  await screen.findByText("Nothing needs you right now");
  await expect.poll(prompt).toBe(null);
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
      onMac: true,
    },
  ]);
  expect(localStorage.getItem("push-endpoint")).toBe(THIS_ENDPOINT);
});

it("stays, saying why, when the user doesn't allow notifications", async () => {
  const push = stubPush({ answer: "default" });
  const fetch = installedApp([]);
  renderApp("/");

  await userEvent.click(await turnOnButton());
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Notifications weren't allowed.",
  );
  expect(push.pushManager.subscribe).not.toHaveBeenCalled();
  expect(sentBodies(fetch, "POST /api/push/subscriptions")).toEqual([]);
});

it("asks for a reload when no service worker runs", async () => {
  stubPush({ worker: false });
  installedApp([]);
  renderApp("/");

  await userEvent.click(await turnOnButton());
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Reload the page and try again.",
  );
});

it("hides on this device after Not now", async () => {
  stubPush();
  installedApp([]);
  renderApp("/");

  await turnOnButton();
  await userEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(prompt()).toBe(null);

  cleanup();
  renderApp("/");
  await listShown();
  expect(prompt()).toBe(null);
});

it("offers it again when the server dropped this device", async () => {
  stubPush({ subscribed: THIS_ENDPOINT });
  installedApp([]);
  renderApp("/");
  expect(await turnOnButton()).toBeTruthy();
});

it("doesn't show when they're already on", async () => {
  stubPush({ subscribed: THIS_ENDPOINT });
  installedApp([device({ endpoint: THIS_ENDPOINT })]);
  renderApp("/");
  await listShown();
  expect(prompt()).toBe(null);
});

it("doesn't show when they're blocked", async () => {
  stubPush({ permission: "denied" });
  installedApp([]);
  renderApp("/");
  await listShown();
  expect(prompt()).toBe(null);
});

it("doesn't show when push is off on the server", async () => {
  stubPush();
  installedApp([], {
    "GET /api/push/key": () =>
      apiError(503, "push_off", "Push notifications aren't set up"),
  });
  renderApp("/");
  await listShown();
  expect(prompt()).toBe(null);
});

it("doesn't show in a browser tab, where onboarding offers the install", async () => {
  stubPush();
  fakeApi(listApi());
  renderApp("/");
  await listShown();
  expect(prompt()).toBe(null);
});
