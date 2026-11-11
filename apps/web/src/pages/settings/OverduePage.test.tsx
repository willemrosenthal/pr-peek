import type { UserSettingsDto } from "@pr-peek/core";
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  apiError,
  fakeApi,
  json,
  sentBodies,
  settingsResponse,
  signedInApi,
  type Handlers,
} from "../../test/fake-api";
import { renderApp } from "../../test/render";

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

const button = (name: string) => screen.findByRole("button", { name });

describe("overdue hours", () => {
  it.each([
    ["Turn orange later", 4, { staleWarnHours: 8 }],
    ["Turn orange sooner", 4, { staleWarnHours: 2 }],
    // A saved value between steps moves to the steps around it.
    ["Turn orange later", 6, { staleWarnHours: 8 }],
    ["Turn orange sooner", 6, { staleWarnHours: 4 }],
    // Past 12 hours, steps are whole days.
    ["Turn orange later", 12, { staleWarnHours: 24 }],
    ["Turn red later", 72, { staleLateHours: 96 }],
  ])("%s from %s hours", async (name, staleWarnHours, sent) => {
    const fetch = timingApi({ staleWarnHours, staleLateHours: 72 }, sent);
    renderApp("/settings/overdue");

    await userEvent.click(await button(name));
    expect(patches(fetch)).toEqual([sent]);
  });

  it("keeps orange before red", async () => {
    timingApi({ staleWarnHours: 12, staleLateHours: 24 });
    renderApp("/settings/overdue");

    expect(await button("Turn orange later")).toHaveProperty("disabled", true);
    expect(await button("Turn red sooner")).toHaveProperty("disabled", true);
    expect(await button("Turn orange sooner")).toHaveProperty(
      "disabled",
      false,
    );
    expect(await button("Turn red later")).toHaveProperty("disabled", false);
  });

  it("stops at an hour and at 30 days", async () => {
    timingApi({ staleWarnHours: 1, staleLateHours: 24 * 30 });
    renderApp("/settings/overdue");

    expect(await button("Turn orange sooner")).toHaveProperty("disabled", true);
    expect(await button("Turn red later")).toHaveProperty("disabled", true);
    expect(screen.getByText("30 days")).toBeTruthy();
  });

  it("shows why a change couldn't be saved, and keeps the value", async () => {
    timingApi(
      {},
      {},
      {
        "PATCH /api/settings": () =>
          apiError(500, "internal_error", "Couldn't save"),
      },
    );
    renderApp("/settings/overdue");

    await userEvent.click(await button("Turn orange later"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't save",
    );
    // The stepper's value. The timeline says "After 4 h".
    expect(screen.getByText("4 h")).toBeTruthy();
  });
});

it("counts only work hours", async () => {
  const fetch = timingApi({}, { workHoursOnly: true });
  renderApp("/settings/overdue");

  await userEvent.click(
    await screen.findByRole("switch", { name: "Only count work hours" }),
  );
  expect(patches(fetch)).toEqual([{ workHoursOnly: true }]);
});

it("changes the timezone", async () => {
  const fetch = timingApi({}, { timezone: "Europe/Paris" });
  renderApp("/settings/overdue");

  await userEvent.selectOptions(
    await screen.findByLabelText("Time zone"),
    "Europe/Paris",
  );
  expect(patches(fetch)).toEqual([{ timezone: "Europe/Paris" }]);
});
