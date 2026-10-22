import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it } from "vitest";
import {
  apiError,
  fakeApi,
  json,
  me,
  signedInApi,
  signedOut,
} from "../test/fake-api";
import { renderApp } from "../test/render";

it("shows the page when signed in", async () => {
  fakeApi(signedInApi());
  renderApp("/settings");
  expect(await screen.findByText("Signed in as octocat")).toBeTruthy();
});

it("sends signed out users to sign in", async () => {
  fakeApi({ "GET /api/me": signedOut });
  const { router } = renderApp("/settings");
  await screen.findByRole("link", { name: "Sign in with GitHub" });
  expect(router.state.location.pathname).toBe("/signin");
});

it("offers a retry when the server can't be reached", async () => {
  let down = true;
  fakeApi(
    signedInApi({
      "GET /api/me": () =>
        down ? apiError(503, "unavailable", "Server is down") : json(me()),
    }),
  );
  renderApp("/settings");

  expect(await screen.findByText("Server is down")).toBeTruthy();
  down = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Signed in as octocat")).toBeTruthy();
});
