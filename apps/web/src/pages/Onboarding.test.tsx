import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import {
  apiError,
  callsTo,
  fakeApi,
  json,
  listApi,
  searchResults,
  sentBodies,
} from "../test/fake-api";
import { renderApp } from "../test/render";

const onboardingApi = (overrides: Record<string, () => Response> = {}) =>
  fakeApi(
    listApi({
      "GET /api/github/repos": () => json(searchResults()),
      "POST /api/sync": () => json({ queued: true }, 202),
      "PATCH /api/settings": () => json({}),
      ...overrides,
    }),
  );

const next = async () =>
  userEvent.click(await screen.findByRole("button", { name: "Next" }));

it("picks repos, sets the timezone, and goes to the list", async () => {
  const fetch = onboardingApi();
  const { router } = renderApp("/onboarding");

  expect(
    await screen.findByRole("heading", { name: "Pick the repos to watch" }),
  ).toBeTruthy();
  await next();
  expect(callsTo(fetch, "/api/sync")).toHaveLength(1);

  await userEvent.selectOptions(
    await screen.findByLabelText("Timezone"),
    "Europe/Paris",
  );
  await next();
  await screen.findByRole("heading", { name: "You're set" });
  expect(sentBodies(fetch, "PATCH /api/settings")).toEqual([
    { timezone: "Europe/Paris" },
  ]);

  await userEvent.click(
    screen.getByRole("button", { name: "Go to your list" }),
  );
  await screen.findByText("Nothing needs you right now");
  expect(router.state.location.pathname).toBe("/");
});

it("goes on when the first sync is refused", async () => {
  onboardingApi({
    "POST /api/sync": () =>
      apiError(429, "rate_limited", "Wait a moment and try again"),
  });
  renderApp("/onboarding");
  await next();
  expect(await screen.findByLabelText("Timezone")).toBeTruthy();
});

it("keeps the detected timezone when the browser's list lacks it", async () => {
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  const detect = vi
    .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
    .mockReturnValue({ ...resolved, timeZone: "UTC" });
  const list = vi
    .spyOn(Intl, "supportedValuesOf")
    .mockReturnValue(["Europe/Paris"]);
  try {
    const fetch = onboardingApi();
    renderApp("/onboarding");
    await next();

    const select = await screen.findByLabelText("Timezone");
    await userEvent.selectOptions(select, "Europe/Paris");
    await userEvent.selectOptions(select, "UTC");
    await next();
    await screen.findByRole("heading", { name: "You're set" });
    expect(sentBodies(fetch, "PATCH /api/settings")).toEqual([
      { timezone: "UTC" },
    ]);
  } finally {
    detect.mockRestore();
    list.mockRestore();
  }
});

it("shows why the timezone couldn't be saved", async () => {
  onboardingApi({
    "PATCH /api/settings": () =>
      apiError(400, "invalid_input", "Unknown timezone"),
  });
  renderApp("/onboarding");
  await next();
  await next();
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Unknown timezone",
  );
});
