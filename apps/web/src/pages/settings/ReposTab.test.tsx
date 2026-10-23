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
  searchResults,
  sentBodies,
  signedInApi,
  watchedRepo,
} from "../../test/fake-api";
import { SAVE_DELAY_MS } from "../../components/ColorPicker";
import { renderApp } from "../../test/render";

const watchedList = () => screen.findByRole("list", { name: "Watched repos" });
const optionList = () =>
  screen.findByRole("list", { name: "Repos you can add" });

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
      ...overrides,
    }),
  );
}

describe("watched repos", () => {
  it("lists them", async () => {
    reposApi([watchedRepo({ owner: "acme", name: "web" })]);
    renderApp("/settings/repos");
    expect(within(await watchedList()).getByText("acme/web")).toBeTruthy();
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

  it("colors one, then turns its color off", async () => {
    const repo = watchedRepo({ owner: "acme", name: "web" });
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
      { color: "#2563eb" },
      { color: null },
    ]);
  });

  // A colored repo with its picker open and `typed` in the hex field. Returns the color
  // saves sent so far, read when called.
  async function typeColor(typed: string) {
    const repo = watchedRepo({ owner: "acme", name: "web", color: "#2563eb" });
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
    expect(saves()).toEqual([{ color: "#e11d48" }, { color: null }]);
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
    expect(within(options).getByText("Private")).toBeTruthy();
    await userEvent.click(
      within(options).getByRole("button", { name: "Add acme/api" }),
    );
    expect(within(options).getByRole("status").textContent).toBe("Adding");

    act(() => finishAdd());
    expect(await within(options).findByText("Watching")).toBeTruthy();
    expect(within(await watchedList()).getByText("acme/api")).toBeTruthy();
    expect(sentBodies(fetch, "POST /api/repos")).toEqual([
      { owner: "acme", name: "api" },
    ]);
    // The row flips without searching GitHub again.
    expect(callsTo(fetch, "/api/github/repos")).toHaveLength(1);
  });

  it("lets other repos be added while one is adding", async () => {
    reposApi(
      [],
      [repoOption({ name: "slow" }), repoOption({ name: "other" })],
      { "POST /api/repos": () => new Promise<Response>(() => {}) },
    );
    renderApp("/settings/repos");

    await userEvent.click(
      await screen.findByRole("button", { name: "Add acme/slow" }),
    );
    expect(
      screen
        .getByRole("button", { name: "Add acme/other" })
        .hasAttribute("disabled"),
    ).toBe(false);
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

  it("searches once typing pauses", async () => {
    // Only the full word has a fake, so a search per letter would fail the test.
    reposApi([], [], {
      "GET /api/github/repos?query=web": () =>
        json(searchResults([repoOption({ owner: "acme", name: "web" })])),
    });
    renderApp("/settings/repos");

    await userEvent.type(await screen.findByLabelText("Add a repo"), "web");
    expect(
      await within(await optionList()).findByText("acme/web"),
    ).toBeTruthy();
  });

  it("adds a repo typed as owner/name that search doesn't find", async () => {
    const watched: WatchedRepoDto[] = [];
    const fetch = reposApi(watched, [], {
      "GET /api/github/repos?query=acme%2Fsecret": () => json(searchResults()),
      "POST /api/repos": () => {
        watched.push(watchedRepo({ owner: "acme", name: "secret" }));
        return json({ repo: watched[0] }, 201);
      },
    });
    renderApp("/settings/repos");

    await userEvent.type(
      await screen.findByLabelText("Add a repo"),
      "acme/secret",
    );
    const options = await optionList();
    expect(within(options).getByText("acme/secret")).toBeTruthy();
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
      "GET /api/github/repos?query=acme%2Fold-name": () =>
        json(searchResults()),
      "POST /api/repos": () => {
        watched.push(watchedRepo({ owner: "acme", name: "new-name" }));
        return json({ repo: watched[0] }, 201);
      },
    });
    renderApp("/settings/repos");

    await userEvent.type(
      await screen.findByLabelText("Add a repo"),
      "acme/old-name",
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Add acme/old-name" }),
    );
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

    await userEvent.click(
      await screen.findByRole("button", { name: "Add acme/api" }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "You can watch up to 50 repos",
    );
  });

  it("shows more", async () => {
    reposApi([], [], {
      "GET /api/github/repos": () =>
        json(searchResults([repoOption({ name: "first" })], "page-2")),
      "GET /api/github/repos?cursor=page-2": () =>
        json(searchResults([repoOption({ name: "second" })])),
    });
    renderApp("/settings/repos");

    await userEvent.click(
      await screen.findByRole("button", { name: "Show more" }),
    );
    expect(await screen.findByText("acme/second")).toBeTruthy();
    expect(screen.getByText("acme/first")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show more" })).toBe(null);
  });
});
