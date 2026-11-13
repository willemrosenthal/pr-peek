import {
  MAX_TOKENS,
  type CheckTokenResponse,
  type TokenDto,
  type TokensResponse,
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

// A token's row, found by its name.
const cardFor = async (name: string) =>
  within(await screen.findByRole("list", { name: "Your tokens" }))
    .getByText(name, { selector: "span" })
    .closest("li")!;

// Opens a token's sheet from its row.
async function openToken(name: string) {
  await userEvent.click(
    within(await cardFor(name)).getByRole("button", {
      name: new RegExp(`^${name}`),
    }),
  );
  return screen.findByRole("dialog");
}

async function pasteAndCheck(token: string) {
  await userEvent.click(
    await screen.findByRole("button", { name: "Add a token" }),
  );
  await userEvent.type(
    screen.getByLabelText("Copy it, then paste it here"),
    token,
  );
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
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
  renderApp("/settings/account");

  const acme = await cardFor("acme");
  expect(acme.textContent).toContain("Fine-grained · covers acme · 14 repos");
  expect(within(acme).queryByRole("button", { name: /^Replace/ })).toBe(null);

  const labs = await cardFor("acme-labs");
  expect(labs.textContent).toContain("Expires in 5 days");
  expect(
    within(labs).getByRole("button", { name: "Replace acme-labs" }),
  ).toBeTruthy();

  const side = await cardFor("Side projects");
  expect(side.textContent).toContain("Classic · every repo you can see");
  expect(side.textContent).toContain("Stopped working");
  expect(
    within(side).getByRole("button", { name: "Replace Side projects" }),
  ).toBeTruthy();

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
  renderApp("/settings/account");

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
  renderApp("/settings/account");

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
  renderApp("/settings/account");

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
  renderApp("/settings/account");

  await userEvent.click(
    within(await cardFor("Work")).getByRole("button", { name: "Replace Work" }),
  );
  expect(screen.getByRole("heading", { name: "Replace Work" })).toBeTruthy();
  await userEvent.type(
    screen.getByLabelText("Copy it, then paste it here"),
    "github_pat_new",
  );
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
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

it("shows a token's details in its sheet, and replaces it from there", async () => {
  settingsApi({
    "GET /api/github-tokens": () =>
      json(
        tokensResponse(
          [githubToken({ id: "a", name: "acme", expiresAt: null })],
          [{ owner: "acme", repos: 3, tokenId: "a" }],
        ),
      ),
  });
  renderApp("/settings/account");

  const sheet = await openToken("acme");
  expect(within(sheet).getByRole("heading", { name: "acme" })).toBeTruthy();
  // Each fact's value, on the right of its name.
  const detail = (name: string) =>
    within(sheet).getByText(name).nextElementSibling?.textContent;
  expect(detail("Covers")).toBe("acme: 3 repos you watch");
  expect(detail("Expires")).toBe("Never");
  expect(detail("Status")).toBe("Working");

  await userEvent.click(within(sheet).getByRole("button", { name: "Replace" }));
  expect(
    await screen.findByRole("heading", { name: "Replace acme" }),
  ).toBeTruthy();
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
  renderApp("/settings/account");

  const sheet = await openToken("acme");
  await userEvent.click(within(sheet).getByRole("button", { name: "Remove" }));
  const asking = within(sheet).getByRole("alert");
  expect(asking.textContent).toContain(
    "Its 3 repos sync with another token or your GitHub sign in",
  );
  await userEvent.click(within(asking).getByRole("button", { name: "Remove" }));

  await expect
    .poll(() => screen.queryByRole("list", { name: "Your tokens" }))
    .toBe(null);
  expect(fetch).toHaveBeenCalledWith(
    "/api/github-tokens/a",
    expect.objectContaining({ method: "DELETE" }),
  );
});

it("shows the most allowed, and stops offering Add there", async () => {
  settingsApi({
    "GET /api/github-tokens": () =>
      json(
        tokensResponse(
          Array.from({ length: MAX_TOKENS }, (_, n) =>
            githubToken({ id: `t${n}`, name: `t${n}` }),
          ),
        ),
      ),
  });
  renderApp("/settings/account");

  expect(
    await screen.findByText(new RegExp(`You have ${MAX_TOKENS} tokens`)),
  ).toBeTruthy();
  expect(screen.getByText(`${MAX_TOKENS} (max ${MAX_TOKENS})`)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add a token" })).toBe(null);
});

it("offers only fine-grained tokens, even to replace a classic one", async () => {
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
  renderApp("/settings/account");

  const fineGrainedOnly = (sheet: HTMLElement) => {
    expect(
      within(sheet)
        .getByRole("link", { name: "Make a fine-grained token on GitHub" })
        .getAttribute("href"),
    ).toBe("https://github.com/settings/personal-access-tokens/new");
    expect(within(sheet).queryByRole("tab")).toBe(null);
  };

  await userEvent.click(
    await screen.findByRole("button", { name: "Add a token" }),
  );
  const sheet = await screen.findByRole("dialog");
  fineGrainedOnly(sheet);

  await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));
  await userEvent.click(
    within(await cardFor("Everything")).getByRole("button", {
      name: "Replace Everything",
    }),
  );
  fineGrainedOnly(await screen.findByRole("dialog"));
});
