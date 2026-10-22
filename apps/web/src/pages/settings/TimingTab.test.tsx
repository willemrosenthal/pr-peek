import type { UserSettingsDto } from "@pr-peek/core";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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
    renderApp("/settings/timing");

    await enter("Turn orange after", "6");
    expect(patches(fetch)).toEqual([{ staleWarnHours: 6 }]);
  });

  it("doesn't save a value that didn't change", async () => {
    const fetch = timingApi();
    renderApp("/settings/timing");

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
    renderApp("/settings/timing");

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
    renderApp("/settings/timing");

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
  renderApp("/settings/timing");

  await userEvent.click(
    await screen.findByRole("switch", { name: "Only count work hours" }),
  );
  expect(patches(fetch)).toEqual([{ workHoursOnly: true }]);
});

it("changes the timezone", async () => {
  const fetch = timingApi({}, { timezone: "Europe/Paris" });
  renderApp("/settings/timing");

  await userEvent.selectOptions(
    await screen.findByLabelText("Timezone"),
    "Europe/Paris",
  );
  expect(patches(fetch)).toEqual([{ timezone: "Europe/Paris" }]);
});

describe("quiet hours", () => {
  it("turns on from 6pm to 9am, then changes the start", async () => {
    const fetch = timingApi({}, { quietStart: "18:00", quietEnd: "09:00" });
    renderApp("/settings/timing");

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
    renderApp("/settings/timing");

    await userEvent.click(
      await screen.findByRole("switch", { name: "Quiet hours" }),
    );
    expect(patches(fetch)).toEqual([{ quietStart: null, quietEnd: null }]);
    expect(screen.queryByLabelText("Quiet from")).toBe(null);
  });

  it("is quiet all weekend", async () => {
    const fetch = timingApi({}, { quietWeekends: true });
    renderApp("/settings/timing");

    await userEvent.click(
      await screen.findByRole("switch", { name: "Quiet all weekend" }),
    );
    expect(patches(fetch)).toEqual([{ quietWeekends: true }]);
  });

  it("lets high urgency through", async () => {
    const fetch = timingApi({}, { highBreaksQuiet: true });
    renderApp("/settings/timing");

    await userEvent.click(
      await screen.findByRole("switch", { name: "Let high urgency through" }),
    );
    expect(patches(fetch)).toEqual([{ highBreaksQuiet: true }]);
  });
});

it("turns on the morning summary at 9am", async () => {
  const fetch = timingApi({}, { digestTime: "09:00" });
  renderApp("/settings/timing");

  await userEvent.click(
    await screen.findByRole("switch", { name: "Morning summary" }),
  );
  expect(patches(fetch)).toEqual([{ digestTime: "09:00" }]);
  expect(
    (await screen.findByLabelText<HTMLInputElement>("Summary at")).value,
  ).toBe("09:00");
});
