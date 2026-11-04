import { act, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GIVE_UP_MS, POLL_MS } from "../../hooks/useSync";
import {
  callsTo,
  fakeApi,
  json,
  listApi,
  me,
  noContent,
  searchResults,
  settingsResponse,
  signedInApi,
  signedOut,
  syncStatus,
} from "../../test/fake-api";
import { stubDisplayMode } from "../../test/install";
import { renderApp } from "../../test/render";
import { stubTauri } from "../../test/tauri";
import { hideWindow, setVisibility } from "../../test/visibility";

it.each(["/settings", "/settings/nope"])(
  "opens General from %s",
  async (path) => {
    fakeApi(signedInApi());
    const { router } = renderApp(path);
    expect(
      await screen.findByRole("heading", { name: "General" }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe("/settings/general");
  },
);

it("switches tabs", async () => {
  fakeApi(listApi({ "GET /api/github/repos": () => json(searchResults()) }));
  renderApp("/settings/general");
  await userEvent.click(await screen.findByRole("link", { name: "Repos" }));
  expect(
    await screen.findByRole("heading", { name: "Repositories" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Repos" }).getAttribute("aria-current"),
  ).toBe("page");
});

describe("when the app hides", () => {
  const hide = () => act(hideWindow);

  it("goes back to the list in the Mac app", async () => {
    stubTauri();
    fakeApi(listApi());
    const { router } = renderApp("/settings/general?shell=tray");
    await screen.findByRole("heading", { name: "General" });
    hide();
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("goes back to the list when the installed app is hidden", async () => {
    stubDisplayMode({ standalone: true });
    fakeApi(listApi());
    const { router } = renderApp("/settings/general");
    await screen.findByRole("heading", { name: "General" });
    act(() => setVisibility("hidden"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("stays put in a browser tab", async () => {
    fakeApi(signedInApi());
    const { router } = renderApp("/settings/general");
    await screen.findByRole("heading", { name: "General" });
    hide();
    expect(router.state.location.pathname).toBe("/settings/general");
  });
});

it("signs out and goes to sign in", async () => {
  let signedIn = true;
  fakeApi(
    signedInApi({
      "GET /api/me": () => (signedIn ? json(me()) : signedOut()),
      "POST /api/auth/signout": () => {
        signedIn = false;
        return noContent();
      },
    }),
  );
  const { router } = renderApp("/settings");

  await userEvent.click(
    await screen.findByRole("button", { name: "Sign out" }),
  );
  await screen.findByRole("link", { name: "Sign in with GitHub" });
  expect(router.state.location.pathname).toBe("/signin");
});

describe("after a change to what the rules find", () => {
  const SAVED_AT = "2026-11-05T12:00:00.000Z";
  const updating = () => screen.queryByText("Updating your list…") !== null;

  // Real time still passes, so the page can load.
  afterEach(() => vi.useRealTimers());

  async function hideBots(lastSyncedAt: () => string) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetch = fakeApi(
      signedInApi({
        "PATCH /api/settings": () =>
          json({
            settings: settingsResponse({ hideBots: true }).settings,
            listUpdatingSince: SAVED_AT,
          }),
        "GET /api/sync/status": () =>
          json(syncStatus({ lastSyncedAt: lastSyncedAt() })),
      }),
    );
    renderApp("/settings/general");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole("switch", { name: "Hide bots" }));
    await waitFor(() => expect(updating()).toBe(true));
    return fetch;
  }

  it("shows that the list is updating, until a sync after the save ends", async () => {
    // A sync that started before the save doesn't count.
    let lastSyncedAt = "2026-11-05T11:59:00.000Z";
    await hideBots(() => lastSyncedAt);
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(updating()).toBe(true);

    lastSyncedAt = SAVED_AT;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await waitFor(() => expect(updating()).toBe(false));
  });

  it("stops after 2 minutes, and reloads the list", async () => {
    const fetch = await hideBots(() => "2026-11-05T11:59:00.000Z");
    const reloads = callsTo(fetch, "/api/summary").length;
    await act(() => vi.advanceTimersByTimeAsync(GIVE_UP_MS + POLL_MS));
    await waitFor(() => expect(updating()).toBe(false));
    expect(callsTo(fetch, "/api/summary").length).toBeGreaterThan(reloads);
  });
});
