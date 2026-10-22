import { screen } from "@testing-library/react";
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
