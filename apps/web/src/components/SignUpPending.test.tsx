import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  callsTo,
  fakeApi,
  json,
  me,
  noContent,
  signedInApi,
  signedOut,
} from "../test/fake-api";
import { renderApp } from "../test/render";

describe("a sign-up request that waits", () => {
  it("shows only the waiting screen, asking for nothing else", async () => {
    const fetch = fakeApi({ "GET /api/me": () => json(me({ pending: true })) });
    renderApp("/");

    expect(
      await screen.findByText("Thanks, octocat. Your request is in."),
    ).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("opens the app once approved, on Check again", async () => {
    let pending = true;
    fakeApi(signedInApi({ "GET /api/me": () => json(me({ pending })) }));
    renderApp("/settings");

    await screen.findByText("Thanks, octocat. Your request is in.");
    pending = false;
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Signed in as octocat")).toBeTruthy();
  });

  it("withdraws after asking, then goes to sign in", async () => {
    let signedIn = true;
    const fetch = fakeApi({
      "GET /api/me": () =>
        signedIn ? json(me({ pending: true })) : signedOut(),
      "DELETE /api/me": () => {
        signedIn = false;
        return noContent();
      },
    });
    renderApp("/");

    await userEvent.click(
      await screen.findByRole("button", { name: "Withdraw your request" }),
    );
    expect(callsTo(fetch, "/api/me").length).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(
      await screen.findByRole("link", { name: "Sign in with GitHub" }),
    ).toBeTruthy();
  });
});
