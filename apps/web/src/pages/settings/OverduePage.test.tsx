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

// Types `value` into a box and leaves it, which saves.
async function enter(label: string, value: string) {
  const box = await screen.findByLabelText(label);
  await userEvent.clear(box);
  if (value) await userEvent.type(box, value);
  await userEvent.tab();
}

describe("overdue hours", () => {
  it("saves when the box loses focus", async () => {
    const fetch = timingApi({}, { staleWarnHours: 6 });
    renderApp("/settings/overdue");

    await enter("Turn orange after", "6");
    expect(patches(fetch)).toEqual([{ staleWarnHours: 6 }]);
  });

  it("doesn't save a value that didn't change", async () => {
    const fetch = timingApi();
    renderApp("/settings/overdue");

    await enter("Turn red after", "24");
    expect(patches(fetch)).toEqual([]);
  });

  it.each([
    ["Turn orange after", "30", "Orange must come before red."],
    ["Turn red after", "2", "Red must come after orange."],
    ["Turn red after", "", "Use a whole number of hours, 1 to 720."],
    ["Turn red after", "1000", "Use a whole number of hours, 1 to 720."],
  ])("refuses %s %j", async (label, value, message) => {
    const fetch = timingApi();
    renderApp("/settings/overdue");

    await enter(label, value);
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(patches(fetch)).toEqual([]);
  });

  it("goes back to the saved value when saving fails", async () => {
    timingApi(
      {},
      {},
      {
        "PATCH /api/settings": () =>
          apiError(500, "internal_error", "Couldn't save"),
      },
    );
    renderApp("/settings/overdue");

    await enter("Turn orange after", "6");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't save",
    );
    expect(
      screen.getByLabelText<HTMLInputElement>("Turn orange after").value,
    ).toBe("4");
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
