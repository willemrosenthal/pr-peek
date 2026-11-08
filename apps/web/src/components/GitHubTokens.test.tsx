import type {
  CheckTokenResponse,
  TokenDto,
  TokensResponse,
} from "@pr-peek/core";
import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it } from "vitest";
import {
  apiError,
  fakeApi,
  githubToken,
  json,
  noContent,
  signedInApi,
  type Handlers,
} from "../test/fake-api";
import { renderApp } from "../test/render";

const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (days: number) =>
  new Date(Date.now() + days * DAY_MS).toISOString();

const tokensResponse = (
  tokens: TokenDto[],
  syncedBy: TokensResponse["syncedBy"] = [],
): TokensResponse => ({ tokens, syncedBy });

const checked = (
  fields: Partial<CheckTokenResponse> = {},
): CheckTokenResponse => ({
  kind: "fine_grained",
  owners: ["bigcorp"],
  scopes: [],
  expiresAt: null,
  name: "bigcorp",
  sameOwnersAs: null,
  reachesWatched: true,
  ...fields,
});

const settingsApi = (handlers: Handlers) => fakeApi(signedInApi(handlers));

const cardFor = async (name: string) =>
  within(await screen.findByRole("list", { name: "Your tokens" }))
    .getByText(name, { selector: "strong" })
    .closest("li")!;

async function pasteAndCheck(token: string) {
  await userEvent.click(
    await screen.findByRole("button", { name: "Add a token" }),
  );
  await userEvent.type(
    screen.getByLabelText("Copy it, then paste it here"),
    token,
  );
  await userEvent.click(screen.getByRole("button", { name: "Check token" }));
}

it("lists each token with what it covers, and offers Replace only when it needs one", async () => {
  settingsApi({
    "GET /api/github-tokens": () =>
      json(
        tokensResponse(
          [
            githubToken({ id: "a", name: "acme", owners: ["acme"] }),
            githubToken({
              id: "b",
              name: "acme-labs",
              owners: ["acme-labs"],
              expiresAt: inDays(5),
            }),
            githubToken({
              id: "c",
              name: "Side projects",
              kind: "classic",
              owners: [],
              status: "stopped",
            }),
          ],
          [
            { owner: "acme", repos: 14, tokenId: "a" },
            { owner: "acme-labs", repos: 3, tokenId: "b" },
            { owner: "octocat", repos: 1, tokenId: null },
          ],
        ),
      ),
  });
  renderApp("/settings");

  const acme = await cardFor("acme");
  expect(acme.textContent).toContain("Covers acme: 14 repos you watch.");
  expect(acme.textContent).toContain("Working.");
  expect(within(acme).queryByRole("button", { name: "Replace" })).toBe(null);

  const labs = await cardFor("acme-labs");
  expect(labs.textContent).toContain("Expires in 5 days.");
  expect(within(labs).getByRole("button", { name: "Replace" })).toBeTruthy();

  const side = await cardFor("Side projects");
  expect(side.textContent).toContain("Classic");
  expect(side.textContent).toContain("Stopped working.");
  expect(within(side).getByRole("button", { name: "Replace" })).toBeTruthy();

  const owners = screen
    .getByRole("heading", { name: "Which token syncs each owner" })
    .closest("section")!;
  expect(within(owners).getByText("GitHub sign in")).toBeTruthy();
  expect(owners.textContent).toContain("acme-labs · 3 repos");
});

it("adds a token: checks it, shows what it reaches, then saves it with a name", async () => {
  let tokens: TokenDto[] = [];
  const fetch = settingsApi({
    "GET /api/github-tokens": () =>
      json(
        tokensResponse(tokens, [{ owner: "bigcorp", repos: 2, tokenId: null }]),
      ),
    "POST /api/github-tokens/check": () => json(checked()),
    "POST /api/github-tokens": () => {
      tokens = [githubToken({ name: "Big Corp", owners: ["bigcorp"] })];
      return json({ token: tokens[0] }, 201);
    },
  });
  renderApp("/settings");

  await pasteAndCheck("github_pat_abc");
  const status = await screen.findByText("GitHub accepted it.");
  expect(status.parentElement!.textContent).toContain(
    "It reaches bigcorp: 2 repos you watch.",
  );
  const name = screen.getByLabelText<HTMLInputElement>("Name");
  expect(name.value).toBe("bigcorp");
  await userEvent.clear(name);
  await userEvent.type(name, "Big Corp");
  await userEvent.click(screen.getByRole("button", { name: "Save token" }));

  expect(await screen.findByText(/Saved Big Corp\./)).toBeTruthy();
  expect(fetch).toHaveBeenCalledWith(
    "/api/github-tokens",
    expect.objectContaining({
      method: "POST",
      body: '{"token":"github_pat_abc","name":"Big Corp"}',
    }),
  );
});

it("shows the server's message when the token is refused", async () => {
  settingsApi({
    "GET /api/github-tokens": () => json(tokensResponse([])),
    "POST /api/github-tokens/check": () =>
      apiError(400, "wrong_account", "This token belongs to someone-else."),
  });
  renderApp("/settings");

  await pasteAndCheck("github_pat_other");
  expect((await screen.findByRole("alert")).textContent).toBe(
    "This token belongs to someone-else.",
  );
});

it("offers to replace a token that reaches the same orgs", async () => {
  const fetch = settingsApi({
    "GET /api/github-tokens": () =>
      json(tokensResponse([githubToken({ id: "old", name: "acme" })])),
    "POST /api/github-tokens/check": () =>
      json(checked({ owners: ["acme"], name: "acme", sameOwnersAs: "old" })),
    "PUT /api/github-tokens/old": () => json({ token: githubToken() }),
  });
  renderApp("/settings");

  await pasteAndCheck("github_pat_new");
  await userEvent.click(
    await screen.findByRole("button", { name: "Replace acme" }),
  );
  expect(await screen.findByText(/Saved acme\./)).toBeTruthy();
  expect(fetch).toHaveBeenCalledWith(
    "/api/github-tokens/old",
    expect.objectContaining({ method: "PUT" }),
  );
});

it("replaces a token from its card, keeping its name", async () => {
  const fetch = settingsApi({
    "GET /api/github-tokens": () =>
      json(
        tokensResponse([
          githubToken({ id: "old", name: "Work", status: "stopped" }),
        ]),
      ),
    "POST /api/github-tokens/check": () => json(checked({ name: "acme" })),
    "PUT /api/github-tokens/old": () => json({ token: githubToken() }),
  });
  renderApp("/settings");

  await userEvent.click(
    within(await cardFor("Work")).getByRole("button", { name: "Replace" }),
  );
  expect(screen.getByRole("heading", { name: "Replace Work" })).toBeTruthy();
  await userEvent.type(
    screen.getByLabelText("Copy it, then paste it here"),
    "github_pat_new",
  );
  await userEvent.click(screen.getByRole("button", { name: "Check token" }));
  expect((await screen.findByLabelText<HTMLInputElement>("Name")).value).toBe(
    "Work",
  );
  await userEvent.click(screen.getByRole("button", { name: "Save token" }));
  expect(fetch).toHaveBeenCalledWith(
    "/api/github-tokens/old",
    expect.objectContaining({
      method: "PUT",
      body: '{"token":"github_pat_new","name":"Work"}',
    }),
  );
});

it("asks before removing a token, saying which repos move", async () => {
  let tokens = [githubToken({ id: "a", name: "acme" })];
  const fetch = settingsApi({
    "GET /api/github-tokens": () =>
      json(tokensResponse(tokens, [{ owner: "acme", repos: 3, tokenId: "a" }])),
    "DELETE /api/github-tokens/a": () => {
      tokens = [];
      return noContent();
    },
  });
  renderApp("/settings");

  const card = await cardFor("acme");
  await userEvent.click(within(card).getByRole("button", { name: "Remove" }));
  expect(within(card).getByRole("alert").textContent).toContain(
    "Its 3 repos sync with another token or your GitHub sign in",
  );
  await userEvent.click(within(card).getByRole("button", { name: "Remove" }));

  await expect
    .poll(() => screen.queryByRole("list", { name: "Your tokens" }))
    .toBe(null);
  expect(fetch).toHaveBeenCalledWith(
    "/api/github-tokens/a",
    expect.objectContaining({ method: "DELETE" }),
  );
});

it("stops offering Add at 5 tokens", async () => {
  settingsApi({
    "GET /api/github-tokens": () =>
      json(
        tokensResponse(
          ["a", "b", "c", "d", "e"].map((id) => githubToken({ id, name: id })),
        ),
      ),
  });
  renderApp("/settings");

  expect(await screen.findByText(/You have 5 tokens/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add a token" })).toBe(null);
});

it("opens the sheet on the recommended fine-grained tab, with a tab for classic tokens", async () => {
  settingsApi({
    "GET /api/github-tokens": () =>
      json(
        tokensResponse([
          githubToken({
            id: "old",
            name: "Everything",
            kind: "classic",
            status: "stopped",
          }),
        ]),
      ),
  });
  renderApp("/settings");

  await userEvent.click(
    await screen.findByRole("button", { name: "Add a token" }),
  );
  const sheet = await screen.findByRole("dialog");
  const fineGrained = within(sheet).getByRole("tab", { name: /Fine-grained/ });
  expect(fineGrained.textContent).toContain("Recommended");
  expect(fineGrained.getAttribute("aria-selected")).toBe("true");
  // What the highlight's style keys on. Base UI's name for it, not data-selected.
  expect(fineGrained.hasAttribute("data-active")).toBe(true);
  expect(
    within(sheet)
      .getByRole("link", { name: "Make a fine-grained token on GitHub" })
      .getAttribute("href"),
  ).toBe("https://github.com/settings/personal-access-tokens/new");

  await userEvent.click(
    within(sheet).getByRole("tab", { name: "Classic token" }),
  );
  expect(
    within(sheet)
      .getByRole("link", { name: "Make a classic token on GitHub" })
      .getAttribute("href"),
  ).toContain("scopes=repo,read:org");

  // Replacing a classic token opens on its tab.
  await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));
  await userEvent.click(
    within(await cardFor("Everything")).getByRole("button", {
      name: "Replace",
    }),
  );
  expect(
    within(await screen.findByRole("dialog"))
      .getByRole("tab", { name: "Classic token" })
      .getAttribute("aria-selected"),
  ).toBe("true");
});
