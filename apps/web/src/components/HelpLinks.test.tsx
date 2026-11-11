import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ISSUES_URL } from "../build";
import { fakeApi, signedInApi, signedOut } from "../test/fake-api";
import { renderApp } from "../test/render";
import { stubTauri } from "../test/tauri";

// Settings rows hold more than their name, like an arrow, so the name only starts them.
const hrefOf = (name: string) =>
  screen
    .getByRole("link", { name: new RegExp(`^${name}`) })
    .getAttribute("href");

it("links to privacy, installing, and feedback from sign in", async () => {
  fakeApi({ "GET /api/me": signedOut });
  renderApp("/signin");
  await screen.findByRole("navigation", { name: "Help" });
  expect(hrefOf("How Git Buddy uses your data")).toBe("/privacy");
  expect(hrefOf("Install on your phone or Mac")).toBe("/install");
  expect(hrefOf("Report a bug or ask for something")).toBe(ISSUES_URL);
});

it("leaves out the install link when signing in to the iPhone app", async () => {
  fakeApi({ "GET /api/me": signedOut });
  renderApp("/signin?shell=ios");
  await screen.findByRole("navigation", { name: "Help" });
  expect(
    screen.queryByRole("link", { name: "Install on your phone or Mac" }),
  ).toBe(null);
});

it("links to privacy and feedback from Settings, without install", async () => {
  fakeApi(signedInApi());
  renderApp("/settings");
  await screen.findByRole("heading", { name: "Help" });
  expect(hrefOf("How Git Buddy uses your data")).toBe("/privacy");
  expect(hrefOf("Report a bug or ask for something")).toBe(ISSUES_URL);
  expect(
    screen.queryByRole("link", { name: "Install on your phone or Mac" }),
  ).toBe(null);
});

it("opens privacy in the browser from the Mac app, where email links work", async () => {
  stubTauri();
  fakeApi(signedInApi());
  renderApp("/settings");
  await screen.findByRole("heading", { name: "Help" });
  const privacy = screen.getByRole("link", {
    name: /^How Git Buddy uses your data/,
  });
  expect(privacy.getAttribute("target")).toBe("_blank");
});
