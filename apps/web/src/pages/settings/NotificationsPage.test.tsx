import { keptTimes, type UserSettingsDto } from "@pr-peek/core";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiError,
  callsTo,
  fakeApi,
  json,
  sentBodies,
  settingsResponse,
  signedInApi,
  type Handlers,
} from "../../test/fake-api";
import { stubDisplayMode } from "../../test/install";
import * as native from "../../test/native";
import { PUBLIC_KEY, stubPush } from "../../test/push";
import { renderApp } from "../../test/render";

vi.mock("../../native", () => import("../../test/native"));

// Settings that start with `stored`, and answer a save with `saved`.
const timingApi = (
  stored: Partial<UserSettingsDto> = {},
  saved: Partial<UserSettingsDto> = {},
  overrides: Handlers = {},
) =>
  fakeApi(
    signedInApi({
      "GET /api/settings": () => json(settingsResponse(stored)),
      "PATCH /api/settings": () =>
        json({ settings: settingsResponse({ ...stored, ...saved }).settings }),
      ...overrides,
    }),
  );

const patches = (fetch: ReturnType<typeof fakeApi>) =>
  sentBodies(fetch, "PATCH /api/settings");

// A server that saves what's sent and keeps each time set, like the real one.
function keepingApi(stored: Partial<UserSettingsDto>) {
  const settings = { ...settingsResponse(stored).settings };
  const fetch = fakeApi(
    signedInApi({
      "GET /api/settings": () => json({ ...settingsResponse(), settings }),
      "PATCH /api/settings": () => {
        const sent = sentBodies(fetch, "PATCH /api/settings").at(
          -1,
        ) as Partial<UserSettingsDto>;
        Object.assign(settings, sent, keptTimes(sent));
        return json({ settings });
      },
    }),
  );
  return fetch;
}

// Clicks a switch, and waits for its save to finish.
async function flip(name: string) {
  const toggle = await screen.findByRole("switch", { name });
  await userEvent.click(toggle);
  await waitFor(() => expect(toggle.hasAttribute("data-disabled")).toBe(false));
}

describe("turning back on", () => {
  it("brings back the quiet hours set before", async () => {
    const fetch = keepingApi({
      keptQuietStart: "21:30",
      keptQuietEnd: "06:00",
    });
    renderApp("/settings/notifications");

    await flip("Quiet hours");
    expect(patches(fetch)).toEqual([
      { quietStart: "21:30", quietEnd: "06:00" },
    ]);
    expect(screen.getByLabelText<HTMLInputElement>("Quiet from").value).toBe(
      "21:30",
    );
  });

  it("brings back a time changed since, off and on again", async () => {
    const fetch = keepingApi({ quietStart: "18:00", quietEnd: "09:00" });
    renderApp("/settings/notifications");

    const from = await screen.findByLabelText<HTMLInputElement>("Quiet from");
    fireEvent.change(from, { target: { value: "20:00" } });
    fireEvent.blur(from);
    await waitFor(() => expect(patches(fetch)).toHaveLength(1));
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLInputElement>("Quiet from").disabled,
      ).toBe(false),
    );
    await flip("Quiet hours");
    await flip("Quiet hours");
    expect(patches(fetch).at(-1)).toEqual({
      quietStart: "20:00",
      quietEnd: "09:00",
    });
  });

  it("brings back the summary time set before", async () => {
    const fetch = keepingApi({ keptDigestTime: "07:45" });
    renderApp("/settings/notifications");

    await flip("Morning summary");
    expect(patches(fetch)).toEqual([{ digestTime: "07:45" }]);
  });
});

describe("quiet hours", () => {
  it("turns on from 6pm to 9am, then changes the start", async () => {
    const fetch = timingApi({}, { quietStart: "18:00", quietEnd: "09:00" });
    renderApp("/settings/notifications");

    await userEvent.click(
      await screen.findByRole("switch", { name: "Quiet hours" }),
    );
    const from = await screen.findByLabelText<HTMLInputElement>("Quiet from");
    expect(from.value).toBe("18:00");
    expect(screen.getByLabelText<HTMLInputElement>("Quiet until").value).toBe(
      "09:00",
    );

    // Disabled until turning on finishes saving.
    await waitFor(() => expect(from.disabled).toBe(false));
    fireEvent.change(from, { target: { value: "20:00" } });
    fireEvent.blur(from);
    await waitFor(() =>
      expect(patches(fetch)).toEqual([
        { quietStart: "18:00", quietEnd: "09:00" },
        { quietStart: "20:00" },
      ]),
    );
  });

  it("turns off", async () => {
    const fetch = timingApi(
      { quietStart: "18:00", quietEnd: "09:00" },
      {
        quietStart: null,
        quietEnd: null,
      },
    );
    renderApp("/settings/notifications");

    await userEvent.click(
      await screen.findByRole("switch", { name: "Quiet hours" }),
    );
    expect(patches(fetch)).toEqual([{ quietStart: null, quietEnd: null }]);
    expect(screen.queryByLabelText("Quiet from")).toBe(null);
  });

  it("is quiet all weekend", async () => {
    const fetch = timingApi({}, { quietWeekends: true });
    renderApp("/settings/notifications");

    await userEvent.click(
      await screen.findByRole("switch", { name: "Quiet all weekend" }),
    );
    expect(patches(fetch)).toEqual([{ quietWeekends: true }]);
  });

  it("lets high urgency through", async () => {
    const fetch = timingApi({}, { highBreaksQuiet: true });
    renderApp("/settings/notifications");

    await userEvent.click(
      await screen.findByRole("switch", { name: "Let high urgency through" }),
    );
    expect(patches(fetch)).toEqual([{ highBreaksQuiet: true }]);
  });
});

it("sets and clears how often to remind after red", async () => {
  const fetch = timingApi({ remindEveryHours: 4 }, { remindEveryHours: null });
  renderApp("/settings/notifications");

  const select = await screen.findByLabelText("After red, remind me");
  expect(select).toHaveProperty("value", "4");
  await userEvent.selectOptions(select, "Never");
  await waitFor(() => expect(select).toHaveProperty("value", ""));
  await userEvent.selectOptions(select, "Every 8 hours");
  expect(patches(fetch)).toEqual([
    { remindEveryHours: null },
    { remindEveryHours: 8 },
  ]);
});

it("turns on the morning summary at 9am", async () => {
  const fetch = timingApi({}, { digestTime: "09:00" });
  renderApp("/settings/notifications");

  await userEvent.click(
    await screen.findByRole("switch", { name: "Morning summary" }),
  );
  expect(patches(fetch)).toEqual([{ digestTime: "09:00" }]);
  expect(
    (await screen.findByLabelText<HTMLInputElement>("Summary at")).value,
  ).toBe("09:00");
});

// Turning them on is tested in NotificationPrompt.test.tsx.
it("offers notifications on this device in the installed app, for after Not now", async () => {
  stubDisplayMode({ standalone: true });
  stubPush();
  localStorage.setItem("pr-peek:notification-prompt-dismissed", "true");
  fakeApi(
    signedInApi({
      "GET /api/push/key": () => json({ publicKey: PUBLIC_KEY }),
      "GET /api/push/subscriptions": () => json({ subscriptions: [] }),
    }),
  );
  renderApp("/settings/notifications");
  const card = await screen.findByRole("list", { name: "This device" });
  expect(
    await within(card).findByRole("button", { name: "Turn on notifications" }),
  ).toBeTruthy();
  // Its own card, above the others.
  const quiet = await screen.findByRole("list", { name: "Quiet times" });
  expect(
    card.compareDocumentPosition(quiet) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("says when notifications are blocked on this device", async () => {
  stubDisplayMode({ standalone: true });
  stubPush({ permission: "denied" });
  fakeApi(
    signedInApi({
      "GET /api/push/key": () => json({ publicKey: PUBLIC_KEY }),
      "GET /api/push/subscriptions": () => json({ subscriptions: [] }),
    }),
  );
  renderApp("/settings/notifications");
  expect(
    await screen.findByText(/Notifications are blocked for Git Buddy/),
  ).toBeTruthy();
});

it("leaves notifications out in a browser tab", async () => {
  fakeApi(signedInApi());
  renderApp("/settings/notifications");
  await screen.findByRole("list", { name: "Quiet times" });
  expect(screen.queryByRole("list", { name: "This device" })).toBe(null);
});

describe("in the iPhone app", () => {
  const PAGE = "/settings/notifications?shell=ios";

  beforeEach(() => native.resetNative());

  const card = () => screen.findByRole("list", { name: "This iPhone" });

  it("turns notifications on, in place of the web's", async () => {
    native.permission.receive = "prompt";
    native.PushNotifications.requestPermissions.mockImplementationOnce(() => {
      native.permission.receive = "granted";
      return Promise.resolve({ receive: "granted" });
    });
    fakeApi(signedInApi());
    renderApp(PAGE);
    await userEvent.click(
      await within(await card()).findByRole("button", {
        name: "Turn on notifications",
      }),
    );
    expect(
      await screen.findByText("Notifications are on for this iPhone."),
    ).toBeTruthy();
    expect(native.PushNotifications.register).toHaveBeenCalled();
    expect(screen.queryByRole("list", { name: "This device" })).toBe(null);
  });

  it("sends a test", async () => {
    const fetch = fakeApi(
      signedInApi({
        "POST /api/apple-devices/test": () => json({ sent: 1, failed: 0 }),
      }),
    );
    renderApp(PAGE);
    await userEvent.click(
      await within(await card()).findByRole("button", { name: "Send a test" }),
    );
    expect(await screen.findByText(/^Sent\./)).toBeTruthy();
    expect(callsTo(fetch, "/api/apple-devices/test")).toHaveLength(1);
  });

  it("says when Apple couldn't deliver the test", async () => {
    fakeApi(
      signedInApi({
        "POST /api/apple-devices/test": () => json({ sent: 0, failed: 1 }),
      }),
    );
    renderApp(PAGE);
    await userEvent.click(
      await screen.findByRole("button", { name: "Send a test" }),
    );
    expect(await screen.findByText(/Apple couldn't deliver it/)).toBeTruthy();
  });

  it("says when the server doesn't have this iPhone yet", async () => {
    fakeApi(
      signedInApi({
        "POST /api/apple-devices/test": () =>
          apiError(404, "not_found", "Not found"),
      }),
    );
    renderApp(PAGE);
    await userEvent.click(
      await screen.findByRole("button", { name: "Send a test" }),
    );
    expect(
      await screen.findByText(/Git Buddy doesn't have this iPhone yet/),
    ).toBeTruthy();
  });

  it("opens iPhone Settings when notifications were turned off there", async () => {
    native.permission.receive = "denied";
    fakeApi(signedInApi());
    renderApp(PAGE);
    expect(
      await screen.findByText(/turned off for Git Buddy in iPhone Settings/),
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Open iPhone Settings" }),
    );
    expect(native.PrPeek.openSettings).toHaveBeenCalled();
  });
});
