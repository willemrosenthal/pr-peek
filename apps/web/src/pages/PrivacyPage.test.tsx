import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PRIVACY_EMAIL } from "../build";
import { fakeApi, signedOut } from "../test/fake-api";
import { renderApp } from "../test/render";

it("can be read without signing in, and gives the privacy email", async () => {
  fakeApi({ "GET /api/me": signedOut });
  const { router } = renderApp("/privacy");
  await screen.findByRole("heading", { name: "Privacy" });
  expect(router.state.location.pathname).toBe("/privacy");
  const emails = screen.getAllByRole("link", { name: PRIVACY_EMAIL });
  expect(emails[0]!.getAttribute("href")).toBe(`mailto:${PRIVACY_EMAIL}`);
});
