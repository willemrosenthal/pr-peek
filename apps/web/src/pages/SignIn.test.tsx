import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  apiError,
  fakeApi,
  json,
  me,
  renderApp,
  signedOut,
} from "../test/render";

const githubLink = () =>
  screen.findByRole("link", { name: "Sign in with GitHub" });

async function signInWithToken(token: string) {
  await userEvent.click(
    screen.getByRole("button", { name: "Use a token instead" }),
  );
  await userEvent.type(screen.getByLabelText("Personal access token"), token);
  await userEvent.click(
    screen.getByRole("button", { name: "Sign in with token" }),
  );
}

describe("sign in with GitHub", () => {
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
});

describe("sign in with a token", () => {
  it("signs in and opens the list", async () => {
    let signedIn = false;
    const fetch = fakeApi({
      "GET /api/me": () => (signedIn ? json(me()) : signedOut()),
      "POST /api/auth/token": () => {
        signedIn = true;
        return json({ isNew: false });
      },
    });
    const { router } = renderApp("/signin");
    await githubLink();

    await signInWithToken("ghp_abc");
    await screen.findByText("Signed in as octocat");
    expect(router.state.location.pathname).toBe("/");
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/token",
      expect.objectContaining({ body: '{"token":"ghp_abc"}' }),
    );
  });

  it("shows the server's message when the token is refused", async () => {
    fakeApi({
      "GET /api/me": signedOut,
      "POST /api/auth/token": () =>
        apiError(400, "bad_token", "GitHub didn't accept this token."),
    });
    renderApp("/signin");
    await githubLink();

    await signInWithToken("ghp_bad");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "GitHub didn't accept this token.",
    );
  });

  it("asks for a new token when a pasted one stopped working", async () => {
    fakeApi({
      "GET /api/me": () =>
        json({ ...me({ authMethod: "pat" }), needsReauth: true }),
    });
    renderApp("/signin");

    expect(await screen.findByText("Your token stopped working")).toBeTruthy();
    expect(screen.getByLabelText("Personal access token")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign in with GitHub" })).toBe(
      null,
    );
  });
});
