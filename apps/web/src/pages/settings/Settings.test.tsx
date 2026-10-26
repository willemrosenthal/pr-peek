import { act, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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
