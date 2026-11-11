import type { UserSettingsDto } from "@pr-peek/core";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import {
  apiError,
  callsTo,
  fakeApi,
  json,
  sentBodies,
  settingsResponse,
  signedInApi,
} from "../../test/fake-api";
import { appScale } from "../../scale";
import { sectionOrder } from "../../sections";
import { renderApp } from "../../test/render";

it("turns hiding bots on, and reloads the list", async () => {
  let hideBots = false;
  const fetch = fakeApi(
    signedInApi({
      "GET /api/settings": () => json(settingsResponse({ hideBots })),
      "PATCH /api/settings": () => {
        hideBots = true;
        return json({ settings: settingsResponse({ hideBots }).settings });
      },
    }),
  );
  renderApp("/settings/display");

  const toggle = await screen.findByRole("switch", { name: "Hide bots" });
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  await userEvent.click(toggle);

  expect(sentBodies(fetch, "PATCH /api/settings")).toEqual([
    { hideBots: true },
  ]);
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  // The summary loaded on sign in, and again after the change.
  expect(callsTo(fetch, "/api/summary").length).toBeGreaterThan(1);
});

it("turns team review requests off", async () => {
  const fetch = fakeApi(
    signedInApi({
      "PATCH /api/settings": () =>
        json({
          settings: settingsResponse({ includeTeamRequests: false }).settings,
        }),
    }),
  );
  renderApp("/settings/display");

  const toggle = await screen.findByRole("switch", {
    name: "Team review requests",
  });
  await userEvent.click(toggle);
  expect(sentBodies(fetch, "PATCH /api/settings")).toEqual([
    { includeTeamRequests: false },
  ]);
  expect(toggle.getAttribute("aria-checked")).toBe("false");
});

it("shows authors only under Needs my review", async () => {
  const fetch = fakeApi(
    signedInApi({
      "PATCH /api/settings": () =>
        json({
          settings: settingsResponse({ showAuthors: "review" }).settings,
        }),
    }),
  );
  renderApp("/settings/display");

  const select = await screen.findByRole<HTMLSelectElement>("combobox", {
    name: "Show authors",
  });
  expect(select.value).toBe("off");
  await userEvent.selectOptions(select, "Needs my review only");
  expect(sentBodies(fetch, "PATCH /api/settings")).toEqual([
    { showAuthors: "review" },
  ]);
  await waitFor(() => expect(select.value).toBe("review"));
});

it("keeps both changes when an earlier save answers last", async () => {
  const saved = (fields: Partial<UserSettingsDto>) =>
    json({ settings: settingsResponse(fields).settings });
  let answerHideBots: (() => void) | undefined;
  fakeApi(
    signedInApi({
      "PATCH /api/settings": () => {
        if (answerHideBots) {
          return saved({ hideBots: true, includeTeamRequests: false });
        }
        // The first save waits. Its answer is from before the second change.
        return new Promise((resolve) => {
          answerHideBots = () => resolve(saved({ hideBots: true }));
        });
      },
    }),
  );
  renderApp("/settings/display");

  const bots = await screen.findByRole("switch", { name: "Hide bots" });
  const teams = screen.getByRole("switch", { name: "Team review requests" });
  await userEvent.click(bots);
  await userEvent.click(teams);
  await waitFor(() => expect(teams.getAttribute("aria-checked")).toBe("false"));
  act(() => answerHideBots?.());

  // A switch is disabled while it saves.
  await waitFor(() => expect(bots.hasAttribute("data-disabled")).toBe(false));
  expect(bots.getAttribute("aria-checked")).toBe("true");
  expect(teams.getAttribute("aria-checked")).toBe("false");
});

it("shows why a setting couldn't be saved, and keeps it as it was", async () => {
  fakeApi(
    signedInApi({
      "PATCH /api/settings": () =>
        apiError(500, "internal_error", "Couldn't save"),
    }),
  );
  renderApp("/settings/display");

  const toggle = await screen.findByRole("switch", { name: "Hide bots" });
  await userEvent.click(toggle);
  expect((await screen.findByRole("alert")).textContent).toBe("Couldn't save");
  expect(toggle.getAttribute("aria-checked")).toBe("false");
});

it("sizes the app on this device, once the slider is let go", async () => {
  fakeApi(signedInApi());
  renderApp("/settings/display");
  const size = await screen.findByRole("slider", { name: "Size" });
  const root = document.documentElement;
  expect(size.getAttribute("aria-valuetext")).toBe("100%");
  try {
    // Dragging fires input events. Letting go fires change.
    fireEvent.input(size, { target: { value: "5" } });
    expect(size.getAttribute("aria-valuetext")).toBe("115%");
    expect(appScale.get()).toBe(1);
    expect(root.style.getPropertyValue("--scale")).toBe("");

    fireEvent.change(size);
    expect(appScale.get()).toBe(1.15);
    expect(root.style.getPropertyValue("--scale")).toBe("1.15");
  } finally {
    document.documentElement.style.removeProperty("--scale");
  }
});

it("moves a section with the keyboard, and saves the order on this device", async () => {
  // jsdom lays nothing out. Stacks each list row 40px under the one before, so the
  // drag can find which row is below.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const at =
        this.tagName === "LI"
          ? [...this.parentElement!.children].indexOf(this)
          : 0;
      return DOMRect.fromRect({ x: 0, y: at * 40, width: 300, height: 40 });
    },
  );
  fakeApi(signedInApi());
  renderApp("/settings/display");
  const order = await screen.findByRole("list", { name: "Section order" });
  const names = () =>
    within(order)
      .getAllByRole("listitem")
      .map((row) => row.textContent);
  expect(names()).toEqual([
    "Needs my review",
    "Replies to me",
    "Assigned to me",
    "My PRs",
    "Watching",
    "Quiet",
  ]);

  const handle = screen.getByRole("button", { name: "Move Needs my review" });
  handle.focus();
  // Space picks it up, an arrow moves it down one, and space drops it.
  await userEvent.keyboard(" ");
  await userEvent.keyboard("{ArrowDown}");
  await userEvent.keyboard(" ");

  await waitFor(() =>
    expect(names()).toEqual([
      "Replies to me",
      "Needs my review",
      "Assigned to me",
      "My PRs",
      "Watching",
      "Quiet",
    ]),
  );
  expect(sectionOrder.get()).toBe("replies,review,assigned,mine,watching");
  expect(
    screen.getByText("Dropped Needs my review in place 2 of 5."),
  ).toBeTruthy();
});
