import type { GitHubTokenDto } from "@pr-peek/core";
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it } from "vitest";
import { apiError, fakeApi, json, me } from "../test/fake-api";
import { renderApp } from "../test/render";

const TOKEN: GitHubTokenDto = {
  expiresAt: null,
  scopes: ["repo", "read:org"],
  invalid: false,
};

async function saveToken(token: string) {
  await userEvent.type(
    await screen.findByLabelText("Personal access token"),
    token,
  );
  await userEvent.click(screen.getByRole("button", { name: "Save token" }));
}

it("adds a token", async () => {
  let githubToken: GitHubTokenDto | null = null;
  const fetch = fakeApi({
    "GET /api/me": () => json(me({ githubToken })),
    "PUT /api/github-token": () => {
      githubToken = TOKEN;
      return json({ githubToken });
    },
  });
  renderApp("/");

  await saveToken("ghp_abc");
  expect(await screen.findByText(/Syncs use your token/)).toBeTruthy();
  expect(fetch).toHaveBeenCalledWith(
    "/api/github-token",
    expect.objectContaining({ body: '{"token":"ghp_abc"}' }),
  );
});

it("shows the server's message when the token is refused", async () => {
  fakeApi({
    "GET /api/me": () => json(me()),
    "PUT /api/github-token": () =>
      apiError(400, "wrong_account", "This token belongs to someone-else."),
  });
  renderApp("/");

  await saveToken("ghp_other");
  expect((await screen.findByRole("alert")).textContent).toBe(
    "This token belongs to someone-else.",
  );
});

it("asks for a new token when the saved one stopped working", async () => {
  fakeApi({
    "GET /api/me": () => json(me({ githubToken: { ...TOKEN, invalid: true } })),
  });
  renderApp("/");

  expect(await screen.findByText("Your token stopped working")).toBeTruthy();
  expect(screen.getByLabelText("Personal access token")).toBeTruthy();
});

it("replaces the token", async () => {
  fakeApi({
    "GET /api/me": () => json(me({ githubToken: TOKEN })),
    "PUT /api/github-token": () => json({ githubToken: TOKEN }),
  });
  renderApp("/");

  await userEvent.click(await screen.findByRole("button", { name: "Replace" }));
  await saveToken("ghp_new");
  expect(await screen.findByText(/Syncs use your token/)).toBeTruthy();
});

it("removes the token", async () => {
  let githubToken: GitHubTokenDto | null = TOKEN;
  fakeApi({
    "GET /api/me": () => json(me({ githubToken })),
    "DELETE /api/github-token": () => {
      githubToken = null;
      return new Response(null, { status: 204 });
    },
  });
  renderApp("/");

  await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
  expect(await screen.findByText("Use a personal access token")).toBeTruthy();
});
