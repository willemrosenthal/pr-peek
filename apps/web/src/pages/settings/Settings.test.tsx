import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it } from "vitest";
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
