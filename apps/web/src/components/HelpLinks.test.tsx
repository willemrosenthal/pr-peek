import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ISSUES_URL } from "../build";
import { fakeApi, signedInApi, signedOut } from "../test/fake-api";
import { renderApp } from "../test/render";

const hrefOf = (name: string) =>
  screen.getByRole("link", { name }).getAttribute("href");

it("links to privacy, installing, and feedback from sign in", async () => {
  fakeApi({ "GET /api/me": signedOut });
  renderApp("/signin");
  await screen.findByRole("navigation", { name: "Help" });
  expect(hrefOf("How Git Buddy uses your data")).toBe("/privacy");
  expect(hrefOf("Install on your phone or Mac")).toBe("/install");
  expect(hrefOf("Report a bug or ask for something")).toBe(ISSUES_URL);
});

it("links to privacy and feedback from Settings, without install", async () => {
  fakeApi(signedInApi());
  renderApp("/settings/general");
  await screen.findByRole("navigation", { name: "Help" });
  expect(hrefOf("How Git Buddy uses your data")).toBe("/privacy");
  expect(hrefOf("Report a bug or ask for something")).toBe(ISSUES_URL);
  expect(
    screen.queryByRole("link", { name: "Install on your phone or Mac" }),
  ).toBe(null);
});
