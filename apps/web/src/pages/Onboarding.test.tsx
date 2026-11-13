import type { CheckTokenResponse, TokenDto } from "@pr-peek/core";
import { cleanup, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import {
  apiError,
  callsTo,
  fakeApi,
  githubToken,
  json,
  listApi,
  type Handlers,
  searchResults,
  sentBodies,
  settingsResponse,
} from "../test/fake-api";
import { stubDisplayMode, stubUserAgent, USER_AGENTS } from "../test/install";
import * as native from "../test/native";
import { PUBLIC_KEY, stubPush } from "../test/push";
import { renderApp } from "../test/render";

vi.mock("../native", () => import("../test/native"));

const onboardingApi = (overrides: Handlers = {}) =>
  fakeApi(
    listApi({
      "GET /api/github/repos": () => json(searchResults()),
      "POST /api/sync": () => json({ queued: true }, 202),
      "PATCH /api/settings": () =>
        json({
          settings: settingsResponse().settings,
          listUpdatingSince: null,
        }),
      "GET /api/push/key": () => json({ publicKey: PUBLIC_KEY }),
      "GET /api/push/subscriptions": () => json({ subscriptions: [] }),
      ...overrides,
    }),
  );

const next = async () =>
  userEvent.click(await screen.findByRole("button", { name: "Next" }));

const skipTokens = async () =>
  userEvent.click(await screen.findByRole("button", { name: "Skip for now" }));

async function finishSteps() {
  await skipTokens();
  await next();
  await next();
  await screen.findByRole("heading", { name: "You're set" });
}

// Turning them on is tested in NotificationPrompt.test.tsx.
it("offers to turn on notifications at the end, in the installed app", async () => {
  stubDisplayMode({ standalone: true });
  stubPush();
  onboardingApi();
  renderApp("/onboarding");
  await finishSteps();
  expect(
    await screen.findByRole("button", { name: "Turn on notifications" }),
  ).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Install the app" })).toBe(null);
});

// The iPhone's button is tested in NotificationsPage.test.tsx.
it("offers the iPhone's notifications, not the install, in the iPhone app", async () => {
  native.resetNative();
  native.permission.receive = "prompt";
  onboardingApi();
  renderApp("/onboarding?shell=ios");
  await finishSteps();
  expect(
    await screen.findByRole("button", { name: "Turn on notifications" }),
  ).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Install the app" })).toBe(null);
});

it("offers the install, not notifications, in a browser tab", async () => {
  stubUserAgent(USER_AGENTS.chrome);
  stubPush();
  onboardingApi();
  renderApp("/onboarding");
  await finishSteps();
  expect(screen.getByRole("heading", { name: "Install the app" })).toBeTruthy();
  expect(screen.getByText(/Notifications come with the app/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Turn on notifications" })).toBe(
    null,
  );
});

it("shows only the install steps on an iPhone outside the Home Screen app", async () => {
  stubUserAgent(USER_AGENTS.iphone);
  onboardingApi();
  renderApp("/onboarding");
  await finishSteps();
  expect(screen.queryByRole("heading", { name: "Get notifications" })).toBe(
    null,
  );
  expect(
    screen.getAllByText(
      "On iPhone, notifications only work in the Home Screen app.",
    ),
  ).toHaveLength(1);
  expect(screen.queryByText(/Notifications come with the app/)).toBe(null);
});

it("picks repos, sets the timezone, and goes to the list", async () => {
  const fetch = onboardingApi();
  const { router } = renderApp("/onboarding");

  await skipTokens();
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
  expect(screen.getByRole("heading", { name: "Install the app" })).toBeTruthy();

  await userEvent.click(
    screen.getByRole("button", { name: "Go to your list" }),
  );
  await screen.findByText("Nothing needs you right now");
  expect(router.state.location.pathname).toBe("/");
});

it("doesn't offer to install or turn on notifications inside the menu bar app", async () => {
  onboardingApi();
  renderApp("/onboarding?shell=tray");
  await finishSteps();
  expect(screen.queryByRole("heading", { name: "Install the app" })).toBe(null);
  expect(screen.queryByRole("heading", { name: "Get notifications" })).toBe(
    null,
  );
});

it("goes on when the first sync is refused", async () => {
  onboardingApi({
    "POST /api/sync": () =>
      apiError(429, "rate_limited", "Wait a moment and try again"),
  });
  renderApp("/onboarding");
  await skipTokens();
  await next();
  expect(await screen.findByLabelText("Timezone")).toBeTruthy();
});

it("keeps the detected timezone when the browser's list lacks it", async () => {
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...resolved,
    timeZone: "UTC",
  });
  vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["Europe/Paris"]);
  const fetch = onboardingApi();
  renderApp("/onboarding");
  await skipTokens();
  await next();

  const select = await screen.findByLabelText("Timezone");
  await userEvent.selectOptions(select, "Europe/Paris");
  await userEvent.selectOptions(select, "UTC");
  await next();
  await screen.findByRole("heading", { name: "You're set" });
  expect(sentBodies(fetch, "PATCH /api/settings")).toEqual([
    { timezone: "UTC" },
  ]);
});

it("shows why the timezone couldn't be saved", async () => {
  onboardingApi({
    "PATCH /api/settings": () =>
      apiError(400, "invalid_input", "Unknown timezone"),
  });
  renderApp("/onboarding");
  await skipTokens();
  await next();
  await next();
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Unknown timezone",
  );
});

// A token API that keeps what's saved. Checking always finds an acme token.
function tokenApi() {
  let tokens: TokenDto[] = [];
  const checked: CheckTokenResponse = {
    kind: "fine_grained",
    owners: ["acme"],
    scopes: [],
    expiresAt: null,
    name: "acme",
    sameOwnersAs: null,
    // Nothing is watched yet during onboarding.
    reachesWatched: false,
  };
  return {
    "GET /api/github-tokens": () => json({ tokens, syncedBy: [] }),
    "POST /api/github-tokens/check": () => json(checked),
    "POST /api/github-tokens": () => {
      tokens = [githubToken({ name: "acme", owners: ["acme"] })];
      return json({ token: tokens[0] }, 201);
    },
  };
}

async function addToken(opener: string) {
  await userEvent.click(await screen.findByRole("button", { name: opener }));
  await userEvent.type(
    await screen.findByLabelText("Copy it, then paste it here"),
    "github_pat_x",
  );
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await screen.findByText("GitHub accepted it.");
}

it("starts by explaining org repos need a token, and adds one there", async () => {
  onboardingApi(tokenApi());
  renderApp("/onboarding");

  expect(
    await screen.findByRole("heading", { name: "Repos from your orgs" }),
  ).toBeTruthy();
  expect(screen.getByText("Needs a token")).toBeTruthy();

  await addToken("Add a token");
  // Nothing is watched yet, so there's nothing to warn about.
  expect(screen.queryByText(/doesn't reach any repo you watch/)).toBe(null);
  await userEvent.click(screen.getByRole("button", { name: "Save token" }));

  expect(await screen.findByText("Added")).toBeTruthy();
  expect(screen.queryByText("Needs a token")).toBe(null);
  expect(screen.queryByRole("button", { name: "Skip for now" })).toBe(null);

  // A fresh form, not the last token's.
  await userEvent.click(screen.getByRole("button", { name: "Add another" }));
  expect(
    await screen.findByLabelText("Copy it, then paste it here"),
  ).toBeTruthy();
  expect(screen.queryByText("GitHub accepted it.")).toBe(null);
  await userEvent.click(screen.getByRole("button", { name: "Close" }));

  await next();
  expect(
    await screen.findByRole("heading", { name: "Pick the repos to watch" }),
  ).toBeTruthy();
});

it("offers a token on the repos step, and reloads the picker's owners after", async () => {
  const fetch = onboardingApi(tokenApi());
  renderApp("/onboarding");
  await skipTokens();
  await screen.findByRole("heading", { name: "Pick the repos to watch" });
  const before = callsTo(fetch, "/api/github/owners").length;

  await addToken("Add a token");
  await userEvent.click(screen.getByRole("button", { name: "Save token" }));

  expect(
    await screen.findByText("Token saved. Its repos show below."),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add another" })).toBeTruthy();
  await vi.waitFor(() =>
    expect(callsTo(fetch, "/api/github/owners").length).toBeGreaterThan(before),
  );
});

it("says when a saved token stopped working, and that a classic one covers every org", async () => {
  onboardingApi({
    "GET /api/github-tokens": () =>
      json({
        tokens: [
          githubToken({
            kind: "classic",
            name: "Work",
            owners: [],
            status: "stopped",
          }),
        ],
        syncedBy: [],
      }),
  });
  renderApp("/onboarding");

  expect(await screen.findByText("Stopped working")).toBeTruthy();
  expect(screen.queryByText("Added")).toBe(null);
  expect(
    screen.getByText(/A classic token covers every org you're in/),
  ).toBeTruthy();
});

it("keeps the step in the URL, so a reload stays on it", async () => {
  onboardingApi();
  const { router } = renderApp("/onboarding?shell=tray&step=timezone");
  expect(await screen.findByLabelText("Timezone")).toBeTruthy();

  await next();
  await screen.findByRole("heading", { name: "You're set" });
  // The menu bar app's flag stays too.
  expect(router.state.location.search).toBe("?shell=tray&step=done");
});

it("starts at the first step when the URL's step is unknown", async () => {
  onboardingApi();
  renderApp("/onboarding?step=nope");
  expect(
    await screen.findByRole("heading", { name: "Repos from your orgs" }),
  ).toBeTruthy();
});

it("can skip the repos for later, with no first sync", async () => {
  const fetch = onboardingApi({ "GET /api/repos": () => json({ repos: [] }) });
  renderApp("/onboarding?step=repos");
  const later = await screen.findByRole("button", { name: "Set up later" });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Next" }).disabled,
  ).toBe(true);

  await userEvent.click(later);
  expect(await screen.findByLabelText("Timezone")).toBeTruthy();
  expect(callsTo(fetch, "/api/sync")).toHaveLength(0);
});

it("goes back to the last step seen when the list sends them here", async () => {
  onboardingApi({
    "GET /api/repos": () => json({ repos: [] }),
    "GET /api/settings": () => json(settingsResponse({ onboarded: false })),
  });
  renderApp("/onboarding?step=repos");
  await userEvent.click(
    await screen.findByRole("button", { name: "Set up later" }),
  );
  await screen.findByLabelText("Timezone");
  cleanup();

  // Like a reload of the list.
  const { router } = renderApp("/");
  expect(await screen.findByLabelText("Timezone")).toBeTruthy();
  expect(router.state.location.pathname).toBe("/onboarding");
});

it("stays on the list once the timezone finishes onboarding", async () => {
  let onboarded = false;
  onboardingApi({
    "GET /api/settings": () => json(settingsResponse({ onboarded })),
    "PATCH /api/settings": () => {
      onboarded = true;
      return json({
        settings: settingsResponse({ onboarded }).settings,
        listUpdatingSince: null,
      });
    },
  });
  localStorage.setItem("pr-peek:onboarding-step", "timezone");
  // The list loads the settings first, and sends them to onboarding.
  const { router } = renderApp("/");
  await screen.findByLabelText("Timezone");
  await next();
  await userEvent.click(
    await screen.findByRole("button", { name: "Go to your list" }),
  );

  await screen.findByText("Nothing needs you right now");
  expect(router.state.location.pathname).toBe("/");
});

it("starts over once it's done", async () => {
  onboardingApi();
  renderApp("/onboarding?step=timezone");
  await next();
  await screen.findByRole("heading", { name: "You're set" });
  cleanup();

  renderApp("/onboarding");
  expect(
    await screen.findByRole("heading", { name: "Repos from your orgs" }),
  ).toBeTruthy();
});

it("doesn't block Next when the watched repos can't load", async () => {
  onboardingApi({
    "GET /api/repos": () => apiError(500, "server_error", "Something broke"),
  });
  renderApp("/onboarding?step=repos");
  await screen.findByRole("heading", { name: "Pick the repos to watch" });
  await vi.waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Next" }).disabled,
    ).toBe(false),
  );
});
