import type { PrLookupResponse } from "@pr-peek/core";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  apiError,
  fakeApi,
  groups,
  type Handlers,
  idlePr,
  important,
  json,
  listApi,
  sentBodies,
} from "../test/fake-api";
import { renderApp } from "../test/render";

// jsdom has no layout, so nothing scrolls.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const LINK = "https://github.com/other/lib/pull/9";
const lookupKey = (link = LINK) =>
  `GET /api/prs/lookup?link=${encodeURIComponent(link)}`;

const found = (fields: Partial<PrLookupResponse> = {}): PrLookupResponse => ({
  owner: "other",
  repo: "lib",
  number: 9,
  title: "Add search",
  author: "sam",
  state: "open",
  tracked: false,
  flagged: false,
  ...fields,
});

const dialog = () => screen.findByRole("dialog");
const input = async () =>
  within(await dialog()).getByRole("textbox", { name: "PR link" });
const addButton = (name: RegExp | string) =>
  within(screen.getByRole("dialog")).getByRole("button", { name });

async function openAndType(text: string) {
  await userEvent.click(
    await screen.findByRole("button", { name: "Add a PR by link" }),
  );
  await userEvent.type(await input(), text);
}

it("adds a PR by its link, then shows its row", async () => {
  // The new row, once the list reloads.
  const row = important(idlePr({ group: "watching" }));
  const shown = { ...row, pr: { ...row.pr, id: "pr-9" } };
  let added = false;
  const fetch = fakeApi(
    listApi({
      "GET /api/items": () => json(groups({ idlePrs: added ? [shown] : [] })),
      [lookupKey()]: () => json(found()),
      "POST /api/prs": () => {
        added = true;
        return json({ id: "pr-9", alreadyFlagged: false }, 201);
      },
    }),
  );
  renderApp("/");

  // Any shape of the link works.
  await openAndType("other/lib#9");
  expect(await screen.findByText("Add search")).toBeTruthy();
  expect(screen.getByText("other/lib#9 · by sam · open")).toBeTruthy();
  await userEvent.click(addButton("Add as important"));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(sentBodies(fetch, "POST /api/prs")).toEqual([{ link: LINK }]);
  await waitFor(() =>
    expect(
      document.querySelector('[data-pr-id="pr-9"]')?.hasAttribute("data-flash"),
    ).toBe(true),
  );
});

it.each([
  [{ tracked: true }, "Flag it", "Already on your list."],
  [
    { tracked: true, flagged: true },
    "Show it",
    "Already on your list, flagged.",
  ],
])("offers to flag a PR already on the list", async (fields, button, note) => {
  fakeApi(listApi({ [lookupKey()]: () => json(found(fields)) }));
  renderApp("/");
  await openAndType(LINK);
  expect(await screen.findByText(note)).toBeTruthy();
  expect(addButton(button)).toBeTruthy();
});

describe("why a link can't be added", () => {
  const tryLink = async (text: string, handlers: Handlers = {}) => {
    fakeApi(listApi(handlers));
    renderApp("/");
    await openAndType(text);
  };

  it("says when the text isn't a PR link, and asks GitHub nothing", async () => {
    await tryLink("hello");
    expect(
      await screen.findByText("That doesn't look like a PR link yet."),
    ).toBeTruthy();
    expect(addButton("Add as important")).toHaveProperty("disabled", true);
  });

  it("says when it's an issue", async () => {
    const issue = "https://github.com/other/lib/pull/10";
    await tryLink(issue, {
      [lookupKey(issue)]: () =>
        apiError(422, "not_a_pr", "That's an issue, not a pull request."),
    });
    expect(
      await screen.findByText("That's an issue, not a pull request."),
    ).toBeTruthy();
  });

  it("points to the token settings when GitHub can't see it", async () => {
    await tryLink(LINK, {
      [lookupKey()]: () =>
        apiError(404, "not_found", "Your GitHub token can't see this PR."),
    });
    const settings = await screen.findByRole("link", { name: "Settings" });
    expect(settings.getAttribute("href")).toBe("/settings/general");
    expect(addButton("Add as important")).toHaveProperty("disabled", true);
  });

  it("shows why adding failed", async () => {
    await tryLink(LINK, {
      [lookupKey()]: () => json(found()),
      "POST /api/prs": () =>
        apiError(
          422,
          "too_many_added",
          "You've added 25 PRs, the most you can. Unflag one to add another.",
        ),
    });
    await screen.findByText("Add search");
    await userEvent.click(addButton("Add as important"));
    expect(await screen.findByText(/You've added 25 PRs/)).toBeTruthy();
  });
});

describe("sharing to Git Buddy", () => {
  it("opens the dialog on the PR link in what was shared", async () => {
    fakeApi(listApi({ [lookupKey()]: () => json(found()) }));
    const { router } = renderApp(
      `/add?text=${encodeURIComponent(`Check this out ${LINK}/files`)}`,
    );
    expect(await input()).toHaveProperty("value", LINK);
    expect(await screen.findByText("Add search")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/");
  });

  it("finds the link in the shared url too", async () => {
    fakeApi(listApi({ [lookupKey()]: () => json(found()) }));
    renderApp(`/add?title=Add%20search&url=${encodeURIComponent(LINK)}`);
    expect(await input()).toHaveProperty("value", LINK);
  });

  it("opens it on the shared text when there's no link", async () => {
    fakeApi(listApi());
    renderApp(`/add?title=Lunch&text=${encodeURIComponent("See you at noon")}`);
    expect(await input()).toHaveProperty("value", "See you at noon Lunch");
    expect(
      screen.getByText("That doesn't look like a PR link yet."),
    ).toBeTruthy();
  });
});
