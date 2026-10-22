import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it } from "vitest";
import {
  fakeApi,
  json,
  me,
  noContent,
  signedInApi,
  signedOut,
} from "../test/fake-api";
import { renderApp } from "../test/render";

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
