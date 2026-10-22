import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it } from "vitest";
import { fakeApi, json, me, signedOut } from "../test/fake-api";
import { renderApp } from "../test/render";

const githubLink = () =>
  screen.findByRole("link", { name: "Sign in with GitHub" });

it("can ask for public repos only", async () => {
  fakeApi({ "GET /api/me": signedOut });
  renderApp("/signin");
  const link = await githubLink();
  expect(link.getAttribute("href")).toBe("/api/auth/github");

  await userEvent.click(screen.getByLabelText("Public repos only"));
  expect(link.getAttribute("href")).toBe("/api/auth/github?scope=public");
});

it.each([
  ["denied", "Sign in was canceled on GitHub."],
  ["nope", "Something went wrong on our side. Try again."],
])("explains the error %s", async (code, message) => {
  fakeApi({ "GET /api/me": signedOut });
  renderApp(`/signin?error=${code}`);
  expect((await screen.findByRole("alert")).textContent).toBe(message);
});

it("sends signed in users to the list", async () => {
  fakeApi({ "GET /api/me": () => json(me()) });
  const { router } = renderApp("/signin");
  await screen.findByText("Signed in as octocat");
  expect(router.state.location.pathname).toBe("/");
});

it("lets users whose GitHub sign in stopped working sign in again", async () => {
  fakeApi({ "GET /api/me": () => json(me({ needsReauth: true })) });
  renderApp("/signin");
  expect(await githubLink()).toBeTruthy();
});
