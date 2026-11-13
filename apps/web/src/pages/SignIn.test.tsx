import { screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  callsTo,
  fakeApi,
  json,
  listApi,
  me,
  signedOut,
} from "../test/fake-api";
import { renderApp } from "../test/render";

const githubLink = () =>
  screen.findByRole("link", { name: "Sign in with GitHub" });

it("has one way to sign in, with no choice of access", async () => {
  fakeApi({ "GET /api/me": signedOut });
  renderApp("/signin");
  expect((await githubLink()).getAttribute("href")).toBe("/api/auth/github");
  expect(screen.queryByRole("checkbox")).toBe(null);
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
  fakeApi(listApi());
  const { router } = renderApp("/signin");
  await screen.findByText("Nothing needs you right now");
  expect(router.state.location.pathname).toBe("/");
});

const INVITE_ONLY = /invite only for now/;

it("says sign-up is invite only", async () => {
  fakeApi({ "GET /api/me": signedOut });
  renderApp("/signin");
  expect(await screen.findByText(INVITE_ONLY)).toBeTruthy();
});

it("lets users whose GitHub sign in stopped working sign in again, with no invite talk", async () => {
  const fetch = fakeApi({
    "GET /api/me": () => json(me({ needsReauth: true })),
  });
  renderApp("/signin");
  expect(await githubLink()).toBeTruthy();
  await waitFor(() => expect(callsTo(fetch, "/api/me")).toHaveLength(1));
  expect(screen.queryByText(INVITE_ONLY)).toBe(null);
});

it("shows what Git Buddy does", async () => {
  fakeApi({ "GET /api/me": signedOut });
  renderApp("/signin");
  expect(await screen.findByText("Reviews you owe, first.")).toBeTruthy();
});
