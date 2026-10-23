import { act, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AWAY_MS } from "../../hooks/useReturnToList";
import {
  fakeApi,
  json,
  listApi,
  me,
  noContent,
  searchResults,
  signedInApi,
  signedOut,
} from "../../test/fake-api";
import { renderApp } from "../../test/render";
import { stubTauri } from "../../test/tauri";

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
  await userEvent.click(
    await screen.findByRole("link", { name: "Repositories" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Repositories" }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Repositories" })
      .getAttribute("aria-current"),
  ).toBe("page");
});

describe("after time away", () => {
  // Leaves the app for `away` ms, then comes back.
  const leaveFor = (away: number) => {
    const left = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(left);
    act(() => {
      window.dispatchEvent(new Event("pr-peek:hidden"));
    });
    clock.mockReturnValue(left + away);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    clock.mockRestore();
  };

  it("goes back to the list in the Mac app, but not after a short trip", async () => {
    stubTauri();
    fakeApi(listApi());
    const { router } = renderApp("/settings/general?shell=tray");
    await screen.findByRole("heading", { name: "General" });

    leaveFor(AWAY_MS - 1000);
    expect(router.state.location.pathname).toBe("/settings/general");
    leaveFor(AWAY_MS);
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("stays put in a browser tab", async () => {
    fakeApi(signedInApi());
    const { router } = renderApp("/settings/general");
    await screen.findByRole("heading", { name: "General" });
    leaveFor(AWAY_MS);
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
