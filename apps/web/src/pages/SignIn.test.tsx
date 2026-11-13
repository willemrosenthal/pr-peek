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
const approval = (on: boolean) => ({
  "GET /api/auth/sign-up": () => json({ approval: on }),
});

it("says sign-up is invite only while an admin approves new users", async () => {
  fakeApi({ "GET /api/me": signedOut, ...approval(true) });
  renderApp("/signin");
  expect(await screen.findByText(INVITE_ONLY)).toBeTruthy();
});

it("has no invite talk while anyone can sign up", async () => {
  const fetch = fakeApi({ "GET /api/me": signedOut });
  renderApp("/signin");
  expect(await githubLink()).toBeTruthy();
  await waitFor(() =>
    expect(callsTo(fetch, "/api/auth/sign-up")).toHaveLength(1),
  );
  expect(screen.queryByText(INVITE_ONLY)).toBe(null);
});

it("lets users whose GitHub sign in stopped working sign in again, with no invite talk", async () => {
  const fetch = fakeApi({
    "GET /api/me": () => json(me({ needsReauth: true })),
    ...approval(true),
  });
  renderApp("/signin");
  expect(await githubLink()).toBeTruthy();
  await waitFor(() => expect(callsTo(fetch, "/api/me")).toHaveLength(1));
  expect(screen.queryByText(INVITE_ONLY)).toBe(null);
  expect(callsTo(fetch, "/api/auth/sign-up")).toHaveLength(0);
});

it("shows what Git Buddy does", async () => {
  fakeApi({ "GET /api/me": signedOut });
  renderApp("/signin");
  expect(await screen.findByText("Reviews you owe, first.")).toBeTruthy();
});
