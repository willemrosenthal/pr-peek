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
import { SAVE_DELAY_MS } from "../../components/ColorPicker";
import { MAX_REPO_PAGES } from "../../queries";
import { renderApp } from "../../test/render";

const watchedList = () => screen.findByRole("list", { name: "Watched repos" });
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

describe("watched repos", () => {
  it("lists them", async () => {
    reposApi([watchedRepo({ owner: "acme", name: "web" })]);
    renderApp("/settings/repos");
    expect(within(await watchedList()).getByText("web")).toBeTruthy();
  });

  it("says when there are none", async () => {
    reposApi([]);
    renderApp("/settings/repos");
    expect(
      await screen.findByText("You're not watching any repos yet."),
    ).toBeTruthy();
  });

  it("pauses one", async () => {
    const repo = watchedRepo({ owner: "acme", name: "web" });
    const fetch = reposApi([repo], [], {
      [`PATCH /api/repos/${repo.id}`]: () => {
        repo.enabled = false;
        return json({ repo });
      },
    });
    renderApp("/settings/repos");

    const toggle = await screen.findByRole("switch", {
      name: "Watch acme/web",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(toggle);
    expect(await screen.findByText("Paused")).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(sentBodies(fetch, `PATCH /api/repos/${repo.id}`)).toEqual([
      { enabled: false },
    ]);
    const notify = screen.getByRole("switch", { name: "Notify for acme/web" });
    expect(notify.getAttribute("aria-disabled")).toBe("true");
  });

  it("mutes one", async () => {
    const repo = watchedRepo({ owner: "acme", name: "web" });
    const fetch = reposApi([repo], [], {
      [`PATCH /api/repos/${repo.id}`]: () => {
        repo.muted = true;
        return json({ repo });
      },
    });
    renderApp("/settings/repos");

    const toggle = await screen.findByRole("switch", {
      name: "Notify for acme/web",
    });
    await userEvent.click(toggle);
    expect(await screen.findByText("Muted")).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(sentBodies(fetch, `PATCH /api/repos/${repo.id}`)).toEqual([
      { muted: true },
    ]);
  });

  it.each([
    ["a starting color", null, "#2563eb"],
    ["its remembered color", "#e11d48", "#e11d48"],
  ])("turns color on with %s, then off", async (_, kept, sent) => {
    const repo = watchedRepo({ owner: "acme", name: "web", color: kept });
    const patch = `PATCH /api/repos/${repo.id}`;
    const fetch = reposApi([repo], [], {
      [patch]: () => {
        Object.assign(repo, sentBodies(fetch, patch).at(-1));
        return json({ repo });
      },
    });
    renderApp("/settings/repos");

    const toggle = await screen.findByRole("switch", {
      name: "Color for acme/web",
    });
    expect(screen.queryByRole("button", { name: /Pick a color/ })).toBe(null);
    await userEvent.click(toggle);
    expect(
      await screen.findByRole("button", { name: "Pick a color for acme/web" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(toggle.getAttribute("aria-disabled")).not.toBe("true"),
    );
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Pick a color/ })).toBe(null),
    );
    expect(sentBodies(fetch, patch)).toEqual([
      { colorOn: true, color: sent },
      { colorOn: false },
    ]);
    expect(repo.color).toBe(sent);
  });

  // A colored repo with its picker open and `typed` in the hex field. Returns the color
  // saves sent so far, read when called.
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

    await userEvent.click(
      await screen.findByRole("button", { name: "Pick a color for acme/web" }),
    );
    const input = await screen.findByLabelText("Hex color");
    await userEvent.clear(input);
    await userEvent.type(input, typed);
    return () => sentBodies(fetch, patch);
  }

  it.each([
    ["e11d48", "#e11d48"],
    ["ABC", "#aabbcc"],
  ])("saves a typed color %s", async (typed, saved) => {
    const saves = await typeColor(typed);
    await waitFor(() => expect(saves().at(-1)).toEqual({ color: saved }));
  });

  it("saves the pick on close, then stays off when color is turned off", async () => {
    const saves = await typeColor("e11d48");
    await userEvent.click(
      screen.getByRole("switch", { name: "Color for acme/web" }),
    );
    // Past the point a waiting save would have gone out.
    await new Promise((resolve) => setTimeout(resolve, SAVE_DELAY_MS + 100));
    expect(saves()).toEqual([{ color: "#e11d48" }, { colorOn: false }]);
  });

  it("removes one", async () => {
    const watched = [watchedRepo({ owner: "acme", name: "web" })];
    reposApi(watched, [], {
      [`DELETE /api/repos/${watched[0]!.id}`]: () => {
        watched.splice(0);
        return noContent();
      },
    });
    renderApp("/settings/repos");

    await userEvent.click(
      await screen.findByRole("button", { name: "Remove acme/web" }),
    );
    expect(
      await screen.findByText("You're not watching any repos yet."),
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
    renderApp("/settings/repos");

    const options = await optionList();
    expect(
      within(options).getByText(/^Private · pushed \d+d ago$/),
    ).toBeTruthy();
    await userEvent.click(
      within(options).getByRole("button", { name: "Add acme/api" }),
    );
    expect(within(options).getByRole("status").textContent).toBe("Adding");

    act(() => finishAdd());
    expect(await within(options).findByText("Watching")).toBeTruthy();
    expect(within(await watchedList()).getByText("api")).toBeTruthy();
    expect(sentBodies(fetch, "POST /api/repos")).toEqual([
      { owner: "acme", name: "api" },
    ]);
    // The row flips without loading the list again.
    expect(callsTo(fetch, "/api/github/repos")).toHaveLength(1);
  });

  it("lets other repos be added while one is adding", async () => {
    reposApi(
      [],
      [repoOption({ name: "slow" }), repoOption({ name: "other" })],
      { "POST /api/repos": () => new Promise<Response>(() => {}) },
    );
    renderApp("/settings/repos");

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
    renderApp("/settings/repos");
    const options = await optionList();

    await userEvent.click(
      within(options).getByRole("button", { name: "Add acme/web" }),
    );
    await within(options).findByText("Watching");
    await userEvent.click(
      await screen.findByRole("button", { name: "Remove acme/web" }),
    );
    expect(
      await within(options).findByRole("button", { name: "Add acme/web" }),
    ).toBeTruthy();
    expect(callsTo(fetch, "/api/github/repos")).toHaveLength(1);
  });

  it(`loads every page in the background, up to ${MAX_REPO_PAGES}`, async () => {
    // Page 11 has no fake, so asking for it would fail the test.
    const fetch = reposApi([], [], repoPages(MAX_REPO_PAGES));
    renderApp("/settings/repos");

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
    renderApp("/settings/repos");

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
    renderApp("/settings/repos");

    expect(await addButton("acme/web")).toBeTruthy();
    expect(callsTo(fetch, "/api/github/repos")).toHaveLength(0);
  });

  it("stops loading pages after an error, like too many asks", async () => {
    const fetch = reposApi([], [], {
      "GET /api/github/repos": () =>
        json(searchResults([repoOption({ name: "first" })], "page-1")),
      "GET /api/github/repos?cursor=page-1": () =>
        apiError(429, "rate_limited", "Wait a moment and try again"),
    });
    renderApp("/settings/repos");

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
    renderApp("/settings/repos");

    expect(await addButton("acme/mine")).toBeTruthy();
    expect((await ownerMenu()).textContent).toContain("All my repos");
  });

  it("filters as you type, forgiving typos, and marks what matched", async () => {
    reposApi(
      [],
      ["web-app", "api", "docs"].map((name) => repoOption({ name })),
    );
    renderApp("/settings/repos");
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
    renderApp("/settings/repos");
    await addButton("acme/web");

    await userEvent.type(await filterBox(), "zzzz");
    expect(await screen.findByText('No repos match "zzzz".')).toBeTruthy();
  });

  it("shows the first 50 matches", async () => {
    reposApi(
      [],
      Array.from({ length: 60 }, (_, i) => repoOption({ name: `r${i}` })),
    );
    renderApp("/settings/repos");

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
    renderApp("/settings/repos");

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
    renderApp("/settings/repos");

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
    renderApp("/settings/repos");

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
    renderApp("/settings/repos");

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
    renderApp("/settings/repos");

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
    renderApp("/settings/repos");

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
    renderApp("/settings/repos");

    await userEvent.click(await addButton("acme/api"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "You can watch up to 50 repos",
    );
  });
});
