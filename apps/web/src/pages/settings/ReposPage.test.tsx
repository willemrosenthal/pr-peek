import type { RepoOption, WatchedRepoDto } from "@pr-peek/core";
import { act, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  apiError,
  callsTo,
  fakeApi,
  json,
  type Handlers,
  noContent,
  repoOption,
  repoOwners,
  searchResults,
  sentBodies,
  signedInApi,
  watchedRepo,
} from "../../test/fake-api";
import { MAX_REPO_PAGES } from "../../queries";
import { renderApp } from "../../test/render";

const optionList = () =>
  screen.findByRole("list", { name: "Repos you can add" });

// The menu: one owner of each kind.
const owners = repoOwners([
  { login: "octocat", kind: "you" },
  { login: "acme", kind: "org" },
  { login: "dana", kind: "shared" },
]);

// A server holding a watch list, and `options` to search. Tests change `watched` in
// place to change what the server returns.
function reposApi(
  watched: WatchedRepoDto[],
  options: RepoOption[] = [],
  overrides: Handlers = {},
) {
  return fakeApi(
    signedInApi({
      "GET /api/repos": () => json({ repos: watched }),
      "GET /api/github/repos": () => json(searchResults(options)),
      "GET /api/github/owners": () => json(owners),
      ...overrides,
    }),
  );
}

// A watched repo's row. Its name is the repo's, then how it's watched, if not Notify.
const repoRow = (name: string) =>
  screen.findByRole("button", { name: new RegExp(`^${name}`) });

// Opens a watched repo's sheet.
async function openSheet(name: string) {
  await userEvent.click(await repoRow(name));
  return screen.findByRole("dialog");
}

describe("watched repos", () => {
  it("lists them by owner", async () => {
    reposApi([
      watchedRepo({ owner: "acme", name: "web" }),
      watchedRepo({ owner: "octocat", name: "dotfiles", muted: true }),
      watchedRepo({ owner: "acme", name: "api", enabled: false }),
    ]);
    renderApp("/settings/repos");

    const acme = await screen.findByRole("list", {
      name: "Watched repos from acme",
    });
    expect(within(acme).getByRole("button", { name: "web" })).toBeTruthy();
    expect(
      within(acme).getByRole("button", { name: "api, Paused" }),
    ).toBeTruthy();
    const mine = screen.getByRole("list", {
      name: "Watched repos from octocat",
    });
    expect(
      within(mine).getByRole("button", { name: "dotfiles, List only" }),
    ).toBeTruthy();
  });

  it("says when there are none", async () => {
    reposApi([]);
    renderApp("/settings/repos");
    expect(
      await screen.findByText("You're not watching any repos yet."),
    ).toBeTruthy();
  });

  it.each([
    ["List only", { enabled: true, muted: true }, "web, List only"],
    ["Paused", { enabled: false }, "web, Paused"],
  ])("switches one to %s", async (choice, sent, rowName) => {
    const repo = watchedRepo({ owner: "acme", name: "web" });
    const patch = `PATCH /api/repos/${repo.id}`;
    const fetch = reposApi([repo], [], {
      [patch]: () => {
        Object.assign(repo, sentBodies(fetch, patch).at(-1));
        return json({ repo });
      },
    });
    renderApp("/settings/repos");

    const sheet = await openSheet("web");
    const notify = within(sheet).getByRole("radio", { name: "Notify" });
    expect(notify).toHaveProperty("checked", true);
    await userEvent.click(within(sheet).getByRole("radio", { name: choice }));
    expect(sentBodies(fetch, patch)).toEqual([sent]);
    await waitFor(() =>
      expect(within(sheet).getByRole("radio", { name: choice })).toHaveProperty(
        "checked",
        true,
      ),
    );
    // The rows behind the sheet are hidden from screen readers until it closes.
    await userEvent.keyboard("{Escape}");
    expect(await repoRow(rowName)).toBeTruthy();
  });

  it("shows why a change couldn't be saved, only in that repo's sheet", async () => {
    const web = watchedRepo({ owner: "acme", name: "web" });
    reposApi([web, watchedRepo({ owner: "acme", name: "api" })], [], {
      [`PATCH /api/repos/${web.id}`]: () =>
        apiError(500, "internal_error", "Couldn't save"),
    });
    renderApp("/settings/repos");

    const sheet = await openSheet("web");
    await userEvent.click(within(sheet).getByRole("radio", { name: "Paused" }));
    expect((await within(sheet).findByRole("alert")).textContent).toBe(
      "Couldn't save",
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBe(null));

    const other = await openSheet("api");
    expect(within(other).queryByRole("alert")).toBe(null);
  });

  it("picks a color, then takes it off", async () => {
    const repo = watchedRepo({ owner: "acme", name: "web" });
    const patch = `PATCH /api/repos/${repo.id}`;
    const fetch = reposApi([repo], [], {
      [patch]: () => {
        Object.assign(repo, sentBodies(fetch, patch).at(-1));
        return json({ repo });
      },
    });
    renderApp("/settings/repos");

    const sheet = await openSheet("web");
    expect(
      within(sheet).getByRole("radio", { name: "No color" }),
    ).toHaveProperty("checked", true);
    await userEvent.click(within(sheet).getByRole("radio", { name: "Green" }));
    await waitFor(() =>
      expect(
        within(sheet).getByRole("radio", { name: "Green" }),
      ).toHaveProperty("checked", true),
    );
    await userEvent.click(
      within(sheet).getByRole("radio", { name: "No color" }),
    );
    await waitFor(() => expect(sentBodies(fetch, patch)).toHaveLength(2));
    expect(sentBodies(fetch, patch)).toEqual([
      { colorOn: true, color: "#16a34a" },
      { colorOn: false },
    ]);
    // Taking it off keeps the color, for next time.
    expect(repo.color).toBe("#16a34a");
  });

  // A colored repo with its sheet and color picker open, and `typed` in the hex field.
  // Returns the color saves sent so far, read when called.
  async function typeColor(typed: string) {
    const repo = watchedRepo({
      owner: "acme",
      name: "web",
      color: "#2563eb",
      colorOn: true,
    });
    const patch = `PATCH /api/repos/${repo.id}`;
    const fetch = reposApi([repo], [], { [patch]: () => json({ repo }) });
    renderApp("/settings/repos");

    const sheet = await openSheet("web");
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Pick a color for acme/web" }),
    );
    const input = await screen.findByLabelText("Hex color");
    await userEvent.clear(input);
    await userEvent.type(input, typed);
    return () => sentBodies(fetch, patch);
  }

  it.each([
    ["e11d47", "#e11d47"],
    ["ABC", "#aabbcc"],
  ])("saves a typed color %s", async (typed, saved) => {
    const saves = await typeColor(typed);
    await waitFor(() =>
      expect(saves().at(-1)).toEqual({ colorOn: true, color: saved }),
    );
  });

  it("saves a typed color right away when the picker closes", async () => {
    const saves = await typeColor("e11d47");
    await userEvent.keyboard("{Escape}");
    expect(saves()).toEqual([{ colorOn: true, color: "#e11d47" }]);
  });

  it("removes one, and closes its sheet", async () => {
    const watched = [watchedRepo({ owner: "acme", name: "web" })];
    reposApi(watched, [], {
      [`DELETE /api/repos/${watched[0]!.id}`]: () => {
        watched.splice(0);
        return noContent();
      },
    });
    renderApp("/settings/repos");

    const sheet = await openSheet("web");
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Remove from Git Buddy" }),
    );
    expect(
      await screen.findByText("You're not watching any repos yet."),
    ).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBe(null));
  });

  it("opens Add repos from the header", async () => {
    reposApi([]);
    const { router } = renderApp("/settings/repos");
    await userEvent.click(await screen.findByRole("link", { name: "Add" }));
    expect(router.state.location.pathname).toBe("/settings/repos/add");
    expect(
      await screen.findByRole("heading", { name: "Add repos" }),
    ).toBeTruthy();
  });
});

// Fake answers for `count` pages of an owner's repos, one repo each. The last page says
// there are more.
function repoPages(count: number, owner?: string): Handlers {
  const handlers: Handlers = {};
  for (let page = 0; page < count; page++) {
    const params = new URLSearchParams({
      ...(owner && { owner }),
      ...(page > 0 && { cursor: `page-${page}` }),
    });
    const repos = [repoOption({ owner: owner ?? "acme", name: `p${page}` })];
    handlers[`GET /api/github/repos${params.size > 0 ? `?${params}` : ""}`] =
      () => json(searchResults(repos, `page-${page + 1}`));
  }
  return handlers;
}

const ownerMenu = () =>
  screen.findByRole("combobox", { name: "Add a repo from" });
// Opens the owner menu and picks `name`.
async function pickOwner(name: string) {
  await userEvent.click(await ownerMenu());
  await userEvent.click(await screen.findByRole("option", { name }));
}
// The number in the filter box, with the words a screen reader hears.
const filterCount = async () =>
  (await filterBox()).closest("label")?.textContent;
const filterBox = () => screen.findByLabelText("Filter repos");
const addButton = (name: string) =>
  screen.findByRole("button", { name: `Add ${name}` });

describe("adding repos", () => {
  it("lists your repos and adds one, showing progress", async () => {
    const option = repoOption({ owner: "acme", name: "api", isPrivate: true });
    const added = watchedRepo({
      owner: "acme",
      name: "api",
      githubRepoId: option.githubRepoId,
    });
    const watched: WatchedRepoDto[] = [];
    let finishAdd = () => {};
    const fetch = reposApi(watched, [option], {
      "POST /api/repos": () =>
        new Promise((resolve) => {
          finishAdd = () => {
            watched.push(added);
            resolve(json({ repo: added }, 201));
          };
        }),
    });
    renderApp("/settings/repos/add");

    const options = await optionList();
    expect(within(options).getByText(/^Private · pushed/)).toBeTruthy();
    await userEvent.click(
      within(options).getByRole("button", { name: "Add acme/api" }),
    );
    expect(within(options).getByRole("status").textContent).toBe("Adding");

    act(() => finishAdd());
    expect(await within(options).findByText("Watching")).toBeTruthy();
    expect(sentBodies(fetch, "POST /api/repos")).toEqual([
      { owner: "acme", name: "api" },
    ]);
    // The row flips without loading the list again.
    expect(callsTo(fetch, "/api/github/repos")).toHaveLength(1);
  });

  const HOUR_MS = 3_600_000;
  it.each([
    ["hours", 3 * HOUR_MS, "Public · pushed 3h ago"],
    ["months", 65 * 24 * HOUR_MS, "Public · pushed 2mo ago"],
    ["years", 400 * 24 * HOUR_MS, "Public · pushed 1y ago"],
  ])("says when a repo was pushed, in %s", async (_, ageMs, details) => {
    const pushedAt = new Date(Date.now() - ageMs).toISOString();
    reposApi([], [repoOption({ pushedAt })]);
    renderApp("/settings/repos/add");
    expect(within(await optionList()).getByText(details)).toBeTruthy();
  });

  it("shows a remembered owner before the menu loads", async () => {
    localStorage.setItem("pr-peek:repo-owner", '"acme"');
    reposApi([], [], {
      "GET /api/github/owners": () => new Promise<Response>(() => {}),
      "GET /api/github/repos?owner=acme": () => json(searchResults()),
    });
    renderApp("/settings/repos/add");

    await userEvent.click(await ownerMenu());
    const menu = await screen.findByRole("listbox");
    expect(within(menu).getByRole("option", { name: "acme" })).toBeTruthy();
    expect(within(menu).queryByRole("group")).toBe(null);
  });

  it("lets other repos be added while one is adding", async () => {
    reposApi(
      [],
      [repoOption({ name: "slow" }), repoOption({ name: "other" })],
      { "POST /api/repos": () => new Promise<Response>(() => {}) },
    );
    renderApp("/settings/repos/add");

    await userEvent.click(await addButton("acme/slow"));
    expect((await addButton("acme/other")).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("offers a repo again after it's added and then removed", async () => {
    const option = repoOption({ owner: "acme", name: "web" });
    const repo = watchedRepo({
      owner: "acme",
      name: "web",
      githubRepoId: option.githubRepoId,
    });
    const watched: WatchedRepoDto[] = [];
    const fetch = reposApi(watched, [option], {
      "POST /api/repos": () => {
        watched.push(repo);
        return json({ repo }, 201);
      },
      [`DELETE /api/repos/${repo.id}`]: () => {
        watched.splice(0);
        return noContent();
      },
    });
    const { router } = renderApp("/settings/repos/add");

    await userEvent.click(await addButton("acme/web"));
    await within(await optionList()).findByText("Watching");

    // Back to the watched repos, to remove it, then back to add.
    await act(() => router.navigate("/settings/repos"));
    const sheet = await openSheet("web");
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Remove from Git Buddy" }),
    );
    await screen.findByText("You're not watching any repos yet.");
    await act(() => router.navigate("/settings/repos/add"));
    expect(await addButton("acme/web")).toBeTruthy();
    // The list of repos to add didn't load again.
    expect(callsTo(fetch, "/api/github/repos")).toHaveLength(1);
  });

  it(`loads every page in the background, up to ${MAX_REPO_PAGES}`, async () => {
    // Page 11 has no fake, so asking for it would fail the test.
    const fetch = reposApi([], [], repoPages(MAX_REPO_PAGES));
    renderApp("/settings/repos/add");

    expect(await addButton(`acme/p${MAX_REPO_PAGES - 1}`)).toBeTruthy();
    expect((await ownerMenu()).textContent).toContain(
      `${MAX_REPO_PAGES} repos`,
    );
    expect(
      screen.getByText(
        "Showing your 1,000 most recently pushed repos. Pick an owner to search all of theirs.",
      ),
    ).toBeTruthy();
    const pages = fetch.mock.calls.filter(([url]) =>
      url.startsWith("/api/github/repos"),
    );
    expect(pages).toHaveLength(MAX_REPO_PAGES);
  });

  it("picks an owner from the menu, and remembers it", async () => {
    reposApi([], [], {
      "GET /api/github/repos?owner=acme": () =>
        json(searchResults([repoOption({ owner: "acme", name: "web" })])),
    });
    renderApp("/settings/repos/add");

    await userEvent.click(await ownerMenu());
    const menu = await screen.findByRole("listbox");
    await within(menu).findByRole("group", { name: "Your orgs" });
    expect(within(menu).getByRole("group", { name: "You" })).toBeTruthy();
    expect(
      within(menu).getByRole("group", { name: "Shared with you" }),
    ).toBeTruthy();
    await userEvent.click(within(menu).getByRole("option", { name: "acme" }));
    expect(await addButton("acme/web")).toBeTruthy();
    expect((await ownerMenu()).textContent).toContain("acme");
    expect(localStorage.getItem("pr-peek:repo-owner")).toBe('"acme"');
  });

  it("starts on the remembered owner, without loading all repos", async () => {
    localStorage.setItem("pr-peek:repo-owner", '"acme"');
    const fetch = reposApi([], [], {
      "GET /api/github/repos?owner=acme": () =>
        json(searchResults([repoOption({ owner: "acme", name: "web" })])),
    });
    renderApp("/settings/repos/add");

    expect(await addButton("acme/web")).toBeTruthy();
    expect(callsTo(fetch, "/api/github/repos")).toHaveLength(0);
  });

  it("shows a repo once when two tokens' lists both have it", async () => {
    const shared = repoOption({ owner: "acme", name: "shared" });
    reposApi([], [], {
      "GET /api/github/repos": () => json(searchResults([shared], "1:")),
      "GET /api/github/repos?cursor=1%3A": () =>
        json(
          searchResults([shared, repoOption({ owner: "globex", name: "app" })]),
        ),
    });
    renderApp("/settings/repos/add");

    expect(await addButton("globex/app")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Add acme/shared" }),
    ).toHaveLength(1);
  });

  it("stops loading pages after an error, like too many asks", async () => {
    const fetch = reposApi([], [], {
      "GET /api/github/repos": () =>
        json(searchResults([repoOption({ name: "first" })], "page-1")),
      "GET /api/github/repos?cursor=page-1": () =>
        apiError(429, "rate_limited", "Wait a moment and try again"),
    });
    renderApp("/settings/repos/add");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Wait a moment and try again",
    );
    expect(screen.getByRole("button", { name: "Add acme/first" })).toBeTruthy();
    expect(callsTo(fetch, "/api/github/repos?cursor=page-1")).toHaveLength(1);
  });

  it("falls back to all repos when a remembered owner isn't listed anymore", async () => {
    localStorage.setItem("pr-peek:repo-owner", '"gone"');
    reposApi([], [repoOption({ name: "mine" })], {
      "GET /api/github/repos?owner=gone": () => json(searchResults()),
    });
    renderApp("/settings/repos/add");

    expect(await addButton("acme/mine")).toBeTruthy();
    expect((await ownerMenu()).textContent).toContain("All my repos");
  });

  it("filters as you type, forgiving typos, and marks what matched", async () => {
    reposApi(
      [],
      ["web-app", "api", "docs"].map((name) => repoOption({ name })),
    );
    renderApp("/settings/repos/add");
    await addButton("acme/docs");

    await userEvent.type(await filterBox(), "wbapp");
    expect(await addButton("acme/web-app")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add acme/docs" })).toBe(null);
    expect(await filterCount()).toBe("1 repo");

    await userEvent.clear(await filterBox());
    await userEvent.type(await filterBox(), "doc");
    expect(await addButton("acme/docs")).toBeTruthy();
    expect(
      [...document.querySelectorAll("mark")].map((m) => m.textContent),
    ).toEqual(["doc"]);
  });

  it("says when nothing matches", async () => {
    reposApi([], [repoOption({ name: "web" })]);
    renderApp("/settings/repos/add");
    await addButton("acme/web");

    await userEvent.type(await filterBox(), "zzzz");
    expect(
      await screen.findByText(
        'No repos match "zzzz". Type owner/name to add any repo.',
      ),
    ).toBeTruthy();
  });

  it("shows the first 50 matches", async () => {
    reposApi(
      [],
      Array.from({ length: 60 }, (_, i) => repoOption({ name: `r${i}` })),
    );
    renderApp("/settings/repos/add");

    const options = await optionList();
    expect(within(options).getAllByRole("button")).toHaveLength(50);
    expect(
      screen.getByText("Showing the first 50. Type more to narrow it down."),
    ).toBeTruthy();
  });

  it("hides forks until asked", async () => {
    reposApi(
      [],
      [repoOption({ name: "own" }), repoOption({ name: "copy", isFork: true })],
    );
    renderApp("/settings/repos/add");

    await addButton("acme/own");
    expect(screen.queryByRole("button", { name: "Add acme/copy" })).toBe(null);
    const forks = screen.getByRole("button", { name: "Show forks" });
    await userEvent.click(forks);
    expect(forks.getAttribute("aria-pressed")).toBe("true");
    expect(await addButton("acme/copy")).toBeTruthy();
    expect(screen.getByText(/^Public · Fork · pushed/)).toBeTruthy();
  });

  it("lists any user or org's repos from Other, and remembers the name", async () => {
    reposApi([], [], {
      "GET /api/github/repos?owner=vercel": () =>
        json(searchResults([repoOption({ owner: "vercel", name: "next" })])),
    });
    renderApp("/settings/repos/add");

    await pickOwner("Other…");
    expect(screen.queryByLabelText("Filter repos")).toBe(null);
    await userEvent.type(
      screen.getByLabelText("GitHub user or org"),
      " vercel ",
    );
    await userEvent.click(screen.getByRole("button", { name: "Show repos" }));
    expect(await addButton("vercel/next")).toBeTruthy();
    expect(localStorage.getItem("pr-peek:repo-owner-other")).toBe('"vercel"');
  });

  it("says when Other's name isn't on GitHub", async () => {
    reposApi([], [], {
      "GET /api/github/repos?owner=nobody": () =>
        apiError(404, "not_found", "No GitHub user or org has that name"),
    });
    renderApp("/settings/repos/add");

    await pickOwner("Other…");
    const box = screen.getByLabelText("GitHub user or org");
    await userEvent.type(box, "not a name");
    expect(
      screen
        .getByRole("button", { name: "Show repos" })
        .hasAttribute("disabled"),
    ).toBe(true);
    await userEvent.clear(box);
    await userEvent.type(box, "nobody{Enter}");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "No GitHub user or org has that name",
    );
    expect(screen.queryByText("No repos here to add.")).toBe(null);
  });

  it(`searches GitHub for the rest of an owner with over ${MAX_REPO_PAGES} pages`, async () => {
    reposApi([], [], {
      ...repoPages(MAX_REPO_PAGES, "acme"),
      // Only the full word has a fake, so a search per letter would fail the test.
      "GET /api/github/repos?owner=acme&query=far": () =>
        json(searchResults([repoOption({ owner: "acme", name: "far-away" })])),
    });
    renderApp("/settings/repos/add");

    await pickOwner("acme");
    expect(
      await screen.findByText(
        "Showing the 1,000 most recently pushed. Type a name to search all of acme's repos.",
      ),
    ).toBeTruthy();
    await userEvent.type(await filterBox(), "far");
    expect(await addButton("acme/far-away")).toBeTruthy();
    expect(
      await screen.findByText("Also searched all of acme's repos."),
    ).toBeTruthy();
    // The count includes what the search found.
    expect(await filterCount()).toBe("1 repo");
  });

  it.each([
    ["owner/name", "acme/secret"],
    ["a link", "https://github.com/acme/secret"],
  ])("adds a repo typed as %s that the list doesn't have", async (_, typed) => {
    const watched: WatchedRepoDto[] = [];
    const fetch = reposApi(watched, [], {
      "POST /api/repos": () => {
        watched.push(watchedRepo({ owner: "acme", name: "secret" }));
        return json({ repo: watched[0] }, 201);
      },
    });
    renderApp("/settings/repos/add");

    await userEvent.type(await filterBox(), typed);
    const options = await optionList();
    await userEvent.click(
      within(options).getByRole("button", { name: "Add acme/secret" }),
    );
    expect(await within(options).findByText("Watching")).toBeTruthy();
    expect(sentBodies(fetch, "POST /api/repos")).toEqual([
      { owner: "acme", name: "secret" },
    ]);
  });

  it("shows a typed repo as watched when GitHub knows it by a new name", async () => {
    const watched: WatchedRepoDto[] = [];
    reposApi(watched, [], {
      "POST /api/repos": () => {
        watched.push(watchedRepo({ owner: "acme", name: "new-name" }));
        return json({ repo: watched[0] }, 201);
      },
    });
    renderApp("/settings/repos/add");

    await userEvent.type(await filterBox(), "acme/old-name");
    await userEvent.click(await addButton("acme/old-name"));
    expect(
      await within(await optionList()).findByText("Watching"),
    ).toBeTruthy();
  });

  it("shows why a repo couldn't be added", async () => {
    reposApi([], [repoOption({ owner: "acme", name: "api" })], {
      "POST /api/repos": () =>
        apiError(422, "too_many_repos", "You can watch up to 50 repos"),
    });
    renderApp("/settings/repos/add");

    await userEvent.click(await addButton("acme/api"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "You can watch up to 50 repos",
    );
  });
});
