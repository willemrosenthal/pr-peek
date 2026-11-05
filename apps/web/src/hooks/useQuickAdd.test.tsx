import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TOAST_MS } from "../components/Toast";
import {
  apiError,
  callsTo,
  fakeApi,
  json,
  listApi,
  noContent,
  sentBodies,
} from "../test/fake-api";
import { renderApp } from "../test/render";

// jsdom has no layout, so nothing scrolls.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const LINK = "https://github.com/other/lib/pull/9";

// The list, where adding PR 9 answers `answer`.
async function setup(
  answer = () => json({ id: "pr-9", alreadyFlagged: false }, 201),
) {
  const fetch = fakeApi(
    listApi({
      "POST /api/prs": answer,
      "DELETE /api/prs/pr-9/important": () => noContent(),
    }),
  );
  renderApp("/");
  await screen.findByRole("button", { name: "Add a PR by link" });
  return fetch;
}

const paste = (text: string, target: Element = document.body) =>
  fireEvent.paste(target, { clipboardData: { getData: () => text } });

// Drags `data` over the list and drops it. Returns whether the browser was stopped from
// acting on the drop itself, like opening the link.
function drop(data: Record<string, string>) {
  const dataTransfer = {
    types: Object.keys(data),
    getData: (type: string) => data[type] ?? "",
  };
  const list = screen.getByRole("main");
  fireEvent.dragOver(list, { dataTransfer });
  return !fireEvent.drop(list, { dataTransfer });
}

describe("pasting a PR link", () => {
  it("adds it, and Undo takes the flag back off", async () => {
    const fetch = await setup();
    paste(`Can you look at ${LINK}/files?`);

    expect(await screen.findByText("Added other/lib#9")).toBeTruthy();
    expect(sentBodies(fetch, "POST /api/prs")).toEqual([{ link: LINK }]);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(callsTo(fetch, "/api/prs/pr-9/important")).toHaveLength(1),
    );
    expect(screen.queryByText("Added other/lib#9")).toBeNull();
  });

  it("offers no Undo for a PR flagged before", async () => {
    await setup(() => json({ id: "pr-9", alreadyFlagged: true }));
    paste(LINK);
    expect(await screen.findByText("Already on your list")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("says why it couldn't add it", async () => {
    await setup(() =>
      apiError(422, "not_a_pr", "That's an issue, not a pull request."),
    );
    paste(LINK);
    expect(
      await screen.findByText("That's an issue, not a pull request."),
    ).toBeTruthy();
  });

  it("leaves other text, and text pasted in a field, alone", async () => {
    const fetch = await setup();
    paste("just some words");
    // A field elsewhere on the page, like a search box.
    const field = document.createElement("input");
    document.body.append(field);
    paste(LINK, field);
    field.remove();

    await act(() => new Promise((done) => setTimeout(done, 10)));
    expect(sentBodies(fetch, "POST /api/prs")).toEqual([]);
  });

  it("goes away after a few seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await setup();
      paste(LINK);
      await screen.findByText("Added other/lib#9");
      await act(() => vi.advanceTimersByTimeAsync(TOAST_MS));
      expect(screen.queryByText("Added other/lib#9")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("dropping a PR link", () => {
  it("adds it, reading the URL list first", async () => {
    const fetch = await setup();
    expect(drop({ "text/uri-list": LINK, "text/plain": "other/lib#1" })).toBe(
      true,
    );
    expect(await screen.findByText("Added other/lib#9")).toBeTruthy();
    expect(sentBodies(fetch, "POST /api/prs")).toEqual([{ link: LINK }]);
  });

  it("shows where to drop while a link is over the list", async () => {
    await setup();
    const list = screen.getByRole("main");
    const row = screen.getByRole("button", { name: "Add a PR by link" });
    const dataTransfer = { types: ["text/plain"], getData: () => "" };
    fireEvent.dragEnter(list, { dataTransfer });
    fireEvent.dragOver(list, { dataTransfer });
    expect(screen.getByText("Drop to add")).toBeTruthy();

    // Crossing onto a row leaves the list's own box, but not the list.
    fireEvent.dragEnter(row, { dataTransfer });
    fireEvent.dragLeave(list, { dataTransfer });
    expect(screen.getByText("Drop to add")).toBeTruthy();
    fireEvent.dragLeave(row, { dataTransfer });
    expect(screen.queryByText("Drop to add")).toBeNull();
  });

  it("ignores other text, without leaving the app for it", async () => {
    const fetch = await setup();
    expect(drop({ "text/uri-list": "https://example.com" })).toBe(true);
    await act(() => new Promise((done) => setTimeout(done, 10)));
    expect(sentBodies(fetch, "POST /api/prs")).toEqual([]);
  });
});
