import type { RepoOption, WatchedRepoDto } from "@pr-peek/core";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  apiError,
  fakeApi,
  json,
  noContent,
  repoOption,
  searchResults,
  sentBodies,
  signedInApi,
  watchedRepo,
} from "../../test/fake-api";
import { renderApp } from "../../test/render";

const watchedList = () => screen.findByRole("list", { name: "Watched repos" });
const optionList = () =>
  screen.findByRole("list", { name: "Repos you can add" });

// A server holding a watch list, and `options` to search.
function reposApi(
  watched: WatchedRepoDto[],
  options: RepoOption[] = [],
  overrides: Record<string, () => Response> = {},
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
  });

  it("removes one", async () => {
    let watched = [watchedRepo({ owner: "acme", name: "web" })];
    reposApi(watched, [], {
      "GET /api/repos": () => json({ repos: watched }),
      [`DELETE /api/repos/${watched[0]!.id}`]: () => {
        watched = [];
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
  it("lists your repos and adds one", async () => {
    const option = repoOption({ owner: "acme", name: "api", isPrivate: true });
    const watched: WatchedRepoDto[] = [];
    const fetch = reposApi(watched, [option], {
      "GET /api/repos": () => json({ repos: watched }),
      "POST /api/repos": () => {
        option.watched = true;
        watched.push(watchedRepo({ owner: "acme", name: "api" }));
        return json({ repo: watched[0] }, 201);
      },
    });
    renderApp("/settings/repos");

    const options = await optionList();
    expect(within(options).getByText("Private")).toBeTruthy();
    await userEvent.click(
      within(options).getByRole("button", { name: "Add acme/api" }),
    );
    expect(await within(options).findByText("Watching")).toBeTruthy();
    expect(within(await watchedList()).getByText("acme/api")).toBeTruthy();
    expect(sentBodies(fetch, "POST /api/repos")).toEqual([
      { owner: "acme", name: "api" },
    ]);
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
    const fetch = reposApi([], [], {
      "GET /api/github/repos?query=acme%2Fsecret": () => json(searchResults()),
      "POST /api/repos": () => json({ repo: watchedRepo() }, 201),
    });
    renderApp("/settings/repos");

    await userEvent.type(
      await screen.findByLabelText("Add a repo"),
      "acme/secret",
    );
    const options = await optionList();
    expect(within(options).getByText("acme/secret")).toBeTruthy();
    await userEvent.click(within(options).getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(sentBodies(fetch, "POST /api/repos")).toEqual([
        { owner: "acme", name: "secret" },
      ]),
    );
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
