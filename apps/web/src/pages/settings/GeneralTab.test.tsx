import type { UserSettingsDto } from "@pr-peek/core";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it } from "vitest";
import {
  apiError,
  callsTo,
  fakeApi,
  json,
  sentBodies,
  settingsResponse,
  signedInApi,
} from "../../test/fake-api";
import { coloredIcon, countStyle } from "../../desktop";
import { renderApp } from "../../test/render";
import { callsOf, stubTauri } from "../../test/tauri";

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
  renderApp("/settings/general");

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
  renderApp("/settings/general");

  const toggle = await screen.findByRole("switch", {
    name: "Team review requests",
  });
  await userEvent.click(toggle);
  expect(sentBodies(fetch, "PATCH /api/settings")).toEqual([
    { includeTeamRequests: false },
  ]);
  expect(toggle.getAttribute("aria-checked")).toBe("false");
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
  renderApp("/settings/general");

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
  renderApp("/settings/general");

  const toggle = await screen.findByRole("switch", { name: "Hide bots" });
  await userEvent.click(toggle);
  expect((await screen.findByRole("alert")).textContent).toBe("Couldn't save");
  expect(toggle.getAttribute("aria-checked")).toBe("false");
});

it("sets the menu bar count and icon color, only inside the Mac app", async () => {
  fakeApi(signedInApi());
  renderApp("/settings/general");
  await screen.findByRole("switch", { name: "Hide bots" });
  expect(screen.queryByLabelText("Menu bar count")).toBe(null);
  cleanup();

  stubTauri({ launch_at_login: true });
  renderApp("/settings/general");
  const select = await screen.findByLabelText("Menu bar count");
  expect(select).toHaveProperty("value", "total");
  await userEvent.selectOptions(select, "A dot");
  expect(select).toHaveProperty("value", "dot");
  expect(countStyle.get()).toBe("dot");

  const colored = screen.getByRole("switch", { name: "Colored icon" });
  expect(colored.getAttribute("aria-checked")).toBe("true");
  await userEvent.click(colored);
  expect(coloredIcon.get()).toBe(false);
});

it("turns launching at login off, only inside the Mac app", async () => {
  fakeApi(signedInApi());
  renderApp("/settings/general");
  await screen.findByRole("switch", { name: "Hide bots" });
  expect(screen.queryByRole("switch", { name: "Launch at login" })).toBe(null);
  cleanup();

  const invoke = stubTauri({ launch_at_login: true });
  renderApp("/settings/general");
  const toggle = await screen.findByRole("switch", { name: "Launch at login" });
  await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));

  await userEvent.click(toggle);
  expect(callsOf(invoke, "set_launch_at_login")).toEqual([{ on: false }]);
});
