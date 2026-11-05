import type {
  ItemDto,
  ItemsResponse,
  MarkSeenBody,
  ShowAuthors,
} from "@pr-peek/core";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import { sectionOrder } from "../sections";
import {
  apiError,
  callsTo,
  fakeApi,
  groups,
  type Handlers,
  idlePr,
  important,
  item,
  json,
  listApi,
  me,
  mergedPr,
  noContent,
  sentBodies,
  settingsResponse,
  syncStatus,
} from "../test/fake-api";
import { renderApp } from "../test/render";
import {
  drag,
  FAR_ENOUGH,
  pull,
  PULL_FAR_ENOUGH,
  stubPointerCapture,
} from "../test/swipe";
import { callsOf, stubTauri } from "../test/tauri";
import { hideWindow, setVisibility } from "../test/visibility";

beforeAll(stubPointerCapture);

// Gives a request that shouldn't happen time to be sent.
const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 10)));

const minutesAgo = (n: number) =>
  new Date(Date.now() - n * 60_000).toISOString();

const sectionButton = (name: RegExp) => screen.findByRole("button", { name });
const rows = () => screen.queryAllByRole("link", { name: /PR/ });
// The Quiet section's button, with its count.
const QUIET = /^Quiet\s*\d/;
// The row's link, found by its URL. Titles like "PR 2" also match "PR 20".
const rowOf = (row: { pr: { url: string } }) => {
  const link = screen
    .getAllByRole("link")
    .find((el) => el.getAttribute("href") === row.pr.url);
  if (!link) throw new Error(`No row for ${row.pr.url}`);
  return link;
};

// A fake preview for `row`, to add to the list's handlers. Rows without an item, like
// merged ones, ask without one.
const previewApi = (
  row: { id: string; pr: { id: string } },
  withItem = true,
): Handlers => ({
  [`GET /api/prs/${row.pr.id}/preview${withItem ? `?item=${row.id}` : ""}`]:
    () =>
      json({
        bodyHtml: "<p>Adds login.</p>",
        openedAge: "2d",
        failingChecks: [],
        reviewers: [],
        comments: [],
        focusId: null,
      }),
});

describe("sections", () => {
  it("shows each section with items, and its count", async () => {
    fakeApi(
      listApi({
        "GET /api/items": () =>
          json(groups({ review: [item(), item()], mine: [item()] })),
      }),
    );
    renderApp("/");

    expect((await sectionButton(/Needs my review/)).textContent).toContain("2");
    expect((await sectionButton(/My PRs/)).textContent).toContain("1");
    expect(screen.queryByRole("button", { name: /Replies to me/ })).toBe(null);
    expect(screen.queryByRole("button", { name: /Assigned to me/ })).toBe(null);
    expect(rows()).toHaveLength(3);
  });

  it("shows assigned PRs between replies and My PRs", async () => {
    const assigned = item({
      kind: "assigned",
      assigned: true,
      assignedState: "ready_to_merge",
    });
    fakeApi(
      listApi({
        "GET /api/items": () =>
          json(
            groups({ replies: [item()], assigned: [assigned], mine: [item()] }),
          ),
      }),
    );
    renderApp("/");

    const titles = await screen.findAllByRole("button", {
      name: /Replies to me|Assigned to me|My PRs/,
    });
    expect(titles.map((title) => title.textContent)).toEqual([
      expect.stringContaining("Replies to me"),
      expect.stringContaining("Assigned to me"),
      expect.stringContaining("My PRs"),
    ]);
    expect(rowOf(assigned).textContent).toContain("Ready to merge");
  });

  // Whether the review row and the My PRs row have pictures.
  it.each<[ShowAuthors, boolean[]]>([
    ["off", [false, false]],
    ["review", [true, false]],
    ["all", [true, true]],
  ])(
    "shows authors' pictures when the setting is %s",
    async (showAuthors, shown) => {
      fakeApi(
        listApi({
          "GET /api/settings": () => json(settingsResponse({ showAuthors })),
          "GET /api/items": () =>
            json(groups({ review: [item()], mine: [item()] })),
        }),
      );
      renderApp("/");

      await sectionButton(/My PRs/);
      await waitFor(() =>
        expect(rows().map((row) => row.querySelector("img") !== null)).toEqual(
          shown,
        ),
      );
    },
  );

  it("lists the user's idle PRs after their items in My PRs", async () => {
    const idle = idlePr();
    const busy = item();
    fakeApi(
      listApi({
        "GET /api/items": () => json(groups({ mine: [busy], idlePrs: [idle] })),
      }),
    );
    renderApp("/");

    expect((await sectionButton(/My PRs/)).textContent).toContain("2");
    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining(busy.pr.title),
      expect.stringContaining(idle.pr.title),
    ]);
  });

  it("lists idle and merged PRs at the end of their sections", async () => {
    const asked = item();
    const flagged = important(idlePr({ group: "review" }));
    const reviewed = mergedPr({ group: "review" });
    const own = mergedPr({ group: "mine" });
    fakeApi(
      listApi({
        "GET /api/items": () =>
          json(
            groups({
              review: [asked],
              idlePrs: [flagged],
              merged: [reviewed, own],
            }),
          ),
      }),
    );
    renderApp("/");

    expect((await sectionButton(/Needs my review/)).textContent).toContain("3");
    expect((await sectionButton(/My PRs/)).textContent).toContain("1");
    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining(asked.pr.title),
      expect.stringContaining("Nothing to do"),
      expect.stringContaining("Merged"),
      expect.stringContaining("Merged"),
    ]);
    expect(rowOf(own).textContent).toContain("Important: ");
  });

  it("still lists idle PRs when nothing needs you", async () => {
    fakeApi(
      listApi({
        "GET /api/items": () => json(groups({ idlePrs: [idlePr()] })),
      }),
    );
    renderApp("/");

    expect(await screen.findByText("Nothing needs you right now")).toBeTruthy();
    expect((await sectionButton(/My PRs/)).textContent).toContain("1");
    expect(rows()).toHaveLength(1);
  });

  it("shows the sections in the order saved in settings, Quiet last", async () => {
    sectionOrder.set("mine,review");
    fakeApi(
      listApi({
        "GET /api/items": () =>
          json(
            groups({
              review: [item()],
              replies: [item({ kind: "reply" })],
              mine: [item()],
              quiet: { items: [item()], idlePrs: [] },
            }),
          ),
      }),
    );
    renderApp("/");

    await sectionButton(/My PRs/);
    const titles = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent?.replace(/\d+$/, ""));
    expect(titles).toEqual([
      "My PRs",
      "Needs my review",
      "Replies to me",
      "Quiet",
    ]);
  });

  it("collapses a section and remembers it", async () => {
    fakeApi(
      listApi({ "GET /api/items": () => json(groups({ review: [item()] })) }),
    );
    renderApp("/");

    const review = await sectionButton(/Needs my review/);
    expect(review.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(review);
    expect(review.getAttribute("aria-expanded")).toBe("false");
    expect(rows()).toHaveLength(0);

    // Still collapsed after the page loads again.
    cleanup();
    renderApp("/");
    const again = await sectionButton(/Needs my review/);
    expect(again.getAttribute("aria-expanded")).toBe("false");
  });

  it("puts quiet PRs in a Quiet section at the bottom", async () => {
    const loud = item();
    const hushed = item({ kind: "reply" });
    const idle = idlePr();
    fakeApi(
      listApi({
        "GET /api/items": () =>
          json(
            groups({
              review: [loud],
              quiet: { items: [hushed], idlePrs: [idle] },
            }),
          ),
      }),
    );
    renderApp("/");

    expect((await sectionButton(QUIET)).textContent).toContain("2");
    expect(screen.queryByRole("button", { name: /Replies to me/ })).toBe(null);
    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining(loud.pr.title),
      expect.stringContaining(hushed.pr.title),
      expect.stringContaining(idle.pr.title),
    ]);
    // One line: no summary.
    expect(rows()[1]!.textContent).not.toContain(hushed.summary);
  });

  // A list that moves `row` into or out of Quiet once the save answers. The save waits
  // for `finish`.
  function quietApi(row: ReturnType<typeof item>, quietAfter: boolean) {
    let quiet = !quietAfter;
    let finish = () => {};
    const method = quietAfter ? "PUT" : "DELETE";
    const fetch = fakeApi(
      listApi({
        "GET /api/items": () =>
          json(
            quiet
              ? groups({ quiet: { items: [row], idlePrs: [] } })
              : groups({ review: [row] }),
          ),
        [`${method} /api/prs/${row.pr.id}/quiet`]: () =>
          new Promise((resolve) => {
            finish = () => {
              quiet = quietAfter;
              resolve(noContent());
            };
          }),
      }),
    );
    return { fetch, finish: () => act(() => finish()) };
  }

  it("quiets a swiped PR right away, then saves it", async () => {
    const asked = item();
    const { fetch, finish } = quietApi(asked, true);
    renderApp("/");

    await sectionButton(/Needs my review/);
    drag(rowOf(asked), -FAR_ENOUGH);
    // Moved before the save answers.
    expect(await sectionButton(QUIET)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Needs my review/ })).toBe(
      null,
    );
    expect(callsTo(fetch, `/api/prs/${asked.pr.id}/quiet`)).toHaveLength(1);

    finish();
    await waitFor(() =>
      expect(callsTo(fetch, "/api/items").length).toBeGreaterThan(1),
    );
    expect(await sectionButton(QUIET)).toBeTruthy();
  });

  it("brings a quiet PR back", async () => {
    const hushed = item();
    const { fetch, finish } = quietApi(hushed, false);
    renderApp("/");

    await sectionButton(QUIET);
    await userEvent.click(screen.getByRole("button", { name: "Bring back" }));
    expect(await sectionButton(/Needs my review/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: QUIET })).toBe(null);
    expect(callsTo(fetch, `/api/prs/${hushed.pr.id}/quiet`)).toHaveLength(1);
    finish();
  });

  // The second row's swipe: left quiets, right marks it important.
  it.each([
    ["two quiets", -FAR_ENOUGH, "quiet"],
    ["a quiet and an important", FAR_ENOUGH, "important"],
  ])("reloads once after %s, so neither jumps back", async (_, dx, save) => {
    const first = item();
    const second = item();
    const saves: (() => void)[] = [];
    const held = () =>
      new Promise<Response>((resolve) =>
        saves.push(() => resolve(noContent())),
      );
    const fetch = fakeApi(
      listApi({
        "GET /api/items": () => json(groups({ review: [first, second] })),
        [`PUT /api/prs/${first.pr.id}/quiet`]: held,
        [`PUT /api/prs/${second.pr.id}/${save}`]: held,
      }),
    );
    renderApp("/");
    await sectionButton(/Needs my review/);
    const loads = () => callsTo(fetch, "/api/items").length;
    const before = loads();

    drag(rowOf(first), -FAR_ENOUGH);
    drag(rowOf(second), dx);
    await waitFor(() => expect(saves).toHaveLength(2));

    await act(() => Promise.resolve(saves[0]!()));
    expect(loads()).toBe(before);
    await act(() => Promise.resolve(saves[1]!()));
    await waitFor(() => expect(loads()).toBe(before + 1));
  });

  it("ignores a bad saved collapse state", async () => {
    localStorage.setItem("pr-peek:collapsed", "42");
    fakeApi(
      listApi({ "GET /api/items": () => json(groups({ review: [item()] })) }),
    );
    renderApp("/");
    const review = await sectionButton(/Needs my review/);
    expect(review.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("preview", () => {
  it("opens a row's preview on right click, and quiets the PR from it", async () => {
    const asked = item();
    const fetch = fakeApi(
      listApi({
        "GET /api/items": () => json(groups({ review: [asked] })),
        ...previewApi(asked),
        [`PUT /api/prs/${asked.pr.id}/quiet`]: () => noContent(),
      }),
    );
    renderApp("/");

    await sectionButton(/Needs my review/);
    fireEvent.contextMenu(rowOf(asked));
    expect(
      await screen.findByRole("dialog", { name: asked.pr.title }),
    ).toBeTruthy();
    expect(await screen.findByText("Adds login.")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Quiet" }));
    expect(callsTo(fetch, `/api/prs/${asked.pr.id}/quiet`)).toHaveLength(1);
  });

  // When it hides is tested with Settings, which goes back to the list the same way.
  it("closes when the app hides", async () => {
    stubTauri();
    const asked = item();
    fakeApi(
      listApi({
        "GET /api/items": () => json(groups({ review: [asked] })),
        ...previewApi(asked),
      }),
    );
    renderApp("/?shell=tray");

    await sectionButton(/Needs my review/);
    fireEvent.contextMenu(rowOf(asked));
    await screen.findByRole("dialog", { name: asked.pr.title });
    act(hideWindow);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBe(null));
  });
});

describe("marking important", () => {
  const hasFlag = (row: { pr: { url: string } }) =>
    rowOf(row).textContent?.includes("Important: ");

  // A list with `rows` where `place` puts them, like `underReview`, that keeps each PR's
  // mark as it's saved.
  function importantApi<Row extends { pr: ItemDto["pr"] }>(
    rows: Row[],
    place: (rows: Row[]) => Partial<ItemsResponse>,
    overrides: Handlers = {},
  ) {
    const marked = new Set(
      rows.filter((row) => row.pr.important).map((row) => row.pr.id),
    );
    const handlers: Handlers = {
      "GET /api/items": () =>
        json(
          groups(
            place(
              rows.map((row) => ({
                ...row,
                pr: { ...row.pr, important: marked.has(row.pr.id) },
              })),
            ),
          ),
        ),
    };
    for (const { pr } of rows) {
      handlers[`PUT /api/prs/${pr.id}/important`] = () => {
        marked.add(pr.id);
        return noContent();
      };
      handlers[`DELETE /api/prs/${pr.id}/important`] = () => {
        marked.delete(pr.id);
        return noContent();
      };
    }
    return fakeApi(listApi({ ...handlers, ...overrides }));
  }
  const underReview = (rows: ItemDto[]) => ({ review: rows });

  it("marks a PR important when swiped right, and keeps its row", async () => {
    const asked = item();
    const fetch = importantApi([asked], underReview);
    renderApp("/");

    await sectionButton(/Needs my review/);
    expect(hasFlag(asked)).toBe(false);
    drag(rowOf(asked), FAR_ENOUGH);
    await waitFor(() => expect(hasFlag(asked)).toBe(true));
    expect(callsTo(fetch, `/api/prs/${asked.pr.id}/important`)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: QUIET })).toBe(null);
  });

  it("unmarks it when swiped right again, not when opened", async () => {
    const marked = important(item());
    const fetch = importantApi([marked], underReview);
    renderApp("/");
    await sectionButton(/Needs my review/);

    // Stops jsdom trying to open the link.
    document.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    fireEvent.click(rowOf(marked));
    expect(hasFlag(marked)).toBe(true);

    drag(rowOf(marked), FAR_ENOUGH);
    await waitFor(() => expect(hasFlag(marked)).toBe(false));
    expect(callsTo(fetch, `/api/prs/${marked.pr.id}/important`)).toHaveLength(
      1,
    );
  });

  it("marks a PR important from its preview, which closes", async () => {
    const asked = item();
    const fetch = importantApi([asked], underReview, previewApi(asked));
    renderApp("/");

    await sectionButton(/Needs my review/);
    fireEvent.contextMenu(rowOf(asked));
    await userEvent.click(
      await screen.findByRole("button", { name: "Important" }),
    );
    expect(callsTo(fetch, `/api/prs/${asked.pr.id}/important`)).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBe(null));
    expect(hasFlag(asked)).toBe(true);
  });

  it("marks a quiet PR important when swiped right, and it stays quiet", async () => {
    const hushed = item();
    const fetch = importantApi([hushed], (rows) => ({
      quiet: { items: rows, idlePrs: [] },
    }));
    renderApp("/");

    await sectionButton(QUIET);
    drag(rowOf(hushed), FAR_ENOUGH);
    await waitFor(() => expect(hasFlag(hushed)).toBe(true));
    expect(callsTo(fetch, `/api/prs/${hushed.pr.id}/important`)).toHaveLength(
      1,
    );
    expect(await sectionButton(QUIET)).toBeTruthy();
  });

  it("unflags a merged PR when swiped either way, which takes it off the list", async () => {
    const left = mergedPr();
    const right = mergedPr();
    // Unflagged, a merged PR leaves the list.
    const fetch = importantApi([left, right], (rows) => ({
      merged: rows.filter((row) => row.pr.important),
    }));
    renderApp("/");
    await sectionButton(/Needs my review/);

    drag(rowOf(left), -FAR_ENOUGH);
    drag(rowOf(right), FAR_ENOUGH);
    await waitFor(() => expect(rows()).toHaveLength(0));
    for (const row of [left, right]) {
      expect(callsTo(fetch, `/api/prs/${row.pr.id}/important`)).toHaveLength(1);
    }
  });

  it("offers no Quiet in a merged PR's preview", async () => {
    const merged = mergedPr();
    fakeApi(
      listApi({
        "GET /api/items": () => json(groups({ merged: [merged] })),
        ...previewApi(merged, false),
      }),
    );
    renderApp("/");

    await sectionButton(/Needs my review/);
    fireEvent.contextMenu(rowOf(merged));
    expect(
      await screen.findByRole("button", { name: "Remove flag" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Quiet" })).toBe(null);
  });

  it("still marks an important PR's new items seen on leaving", async () => {
    const marked = important(item({ unseen: true }));
    const fetch = importantApi([marked], underReview);
    renderApp("/");
    await sectionButton(/Needs my review/);

    act(() => setVisibility("hidden"));
    expect(sentBodies(fetch, "POST /api/items/seen")).toEqual([
      { ids: [marked.id] },
    ]);
  });
});

describe("the Watching section", () => {
  const hasFlag = (row: { pr: { url: string } }) =>
    rowOf(row).textContent?.includes("Important: ");

  it("lists flagged PRs that fit no other section, without their flags", async () => {
    const watched = important(idlePr({ group: "watching" }));
    const merged = mergedPr({ group: "watching" });
    const mine = important(idlePr({ group: "mine" }));
    fakeApi(
      listApi({
        "GET /api/items": () =>
          json(groups({ idlePrs: [watched, mine], merged: [merged] })),
      }),
    );
    renderApp("/");

    await sectionButton(/^Watching\s*2/);
    expect(hasFlag(watched)).toBe(false);
    expect(hasFlag(merged)).toBe(false);
    // The same flag in another section shows.
    expect(hasFlag(mine)).toBe(true);
  });

  it("says Stop watching in a row's preview", async () => {
    const watched = important(idlePr({ group: "watching" }));
    const fetch = fakeApi(
      listApi({
        "GET /api/items": () => json(groups({ idlePrs: [watched] })),
        [`DELETE /api/prs/${watched.pr.id}/important`]: () => noContent(),
        ...previewApi(watched, false),
      }),
    );
    renderApp("/");

    await sectionButton(/Watching/);
    fireEvent.contextMenu(rowOf(watched));
    await userEvent.click(
      await screen.findByRole("button", { name: "Stop watching" }),
    );
    expect(callsTo(fetch, `/api/prs/${watched.pr.id}/important`)).toHaveLength(
      1,
    );
  });
});

describe("marking seen", () => {
  const newItem = () => item({ unseen: true });

  // The ids in each request to mark items seen.
  const seenRequests = (fetch: ReturnType<typeof fakeApi>) =>
    sentBodies(fetch, "POST /api/items/seen").map(
      (body) => (body as MarkSeenBody).ids,
    );

  it("marks the new items in open sections when the tab is hidden", async () => {
    const review = [newItem(), item()];
    const mine = [newItem()];
    localStorage.setItem("pr-peek:collapsed", '["mine"]');
    const fetch = fakeApi(
      listApi({ "GET /api/items": () => json(groups({ review, mine })) }),
    );
    renderApp("/");
    await sectionButton(/Needs my review/);
    expect(seenRequests(fetch)).toEqual([]);

    act(() => setVisibility("hidden"));
    expect(seenRequests(fetch)).toEqual([[review[0]!.id]]);
  });

  it("marks every item on a new row's PR", async () => {
    const review = [item({ unseen: true, otherIds: ["other-1", "other-2"] })];
    const fetch = fakeApi(
      listApi({ "GET /api/items": () => json(groups({ review })) }),
    );
    renderApp("/");
    await sectionButton(/Needs my review/);

    act(() => setVisibility("hidden"));
    expect(seenRequests(fetch)).toEqual([
      [review[0]!.id, "other-1", "other-2"],
    ]);
  });

  it("marks them when going to another page", async () => {
    const review = [newItem()];
    const fetch = fakeApi(
      listApi({ "GET /api/items": () => json(groups({ review })) }),
    );
    renderApp("/");
    await userEvent.click(
      await screen.findByRole("link", { name: "Settings" }),
    );
    await waitFor(() => expect(seenRequests(fetch)).toEqual([[review[0]!.id]]));
  });

  it("doesn't mark them when dev mode runs effects twice", async () => {
    const fetch = fakeApi(
      listApi({
        "GET /api/items": () => json(groups({ review: [newItem()] })),
      }),
    );
    renderApp("/", { strict: true });
    await sectionButton(/Needs my review/);
    await settle();
    expect(seenRequests(fetch)).toEqual([]);
  });

  it("marks them when the menu bar window hides", async () => {
    const review = [newItem()];
    const fetch = fakeApi(
      listApi({ "GET /api/items": () => json(groups({ review })) }),
    );
    renderApp("/?shell=tray");
    await sectionButton(/Needs my review/);

    act(hideWindow);
    expect(seenRequests(fetch)).toEqual([[review[0]!.id]]);
  });

  it("marks each item once", async () => {
    const review = [newItem()];
    const fetch = fakeApi(
      listApi({ "GET /api/items": () => json(groups({ review })) }),
    );
    renderApp("/");
    await sectionButton(/Needs my review/);

    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    act(() => setVisibility("hidden"));
    expect(seenRequests(fetch)).toHaveLength(1);
  });

  it("skips items that loaded while the tab was hidden, until it's shown", async () => {
    setVisibility("hidden");
    const review = [newItem()];
    const fetch = fakeApi(
      listApi({ "GET /api/items": () => json(groups({ review })) }),
    );
    renderApp("/");
    await sectionButton(/Needs my review/);

    act(() => setVisibility("hidden"));
    expect(seenRequests(fetch)).toEqual([]);
    act(() => setVisibility("visible"));
    act(() => setVisibility("hidden"));
    expect(seenRequests(fetch)).toEqual([[review[0]!.id]]);
  });

  it("tries again when marking fails", async () => {
    let down = true;
    const review = [newItem()];
    const fetch = fakeApi(
      listApi({
        "GET /api/items": () => json(groups({ review })),
        "POST /api/items/seen": () =>
          down ? apiError(500, "internal_error", "Server error") : noContent(),
      }),
    );
    renderApp("/");
    await sectionButton(/Needs my review/);

    act(() => setVisibility("hidden"));
    down = false;
    act(() => setVisibility("visible"));
    // Hides again until the failed request has finished.
    await waitFor(() => {
      act(() => setVisibility("hidden"));
      expect(seenRequests(fetch)).toHaveLength(2);
    });
  });
});

describe("tray mode", () => {
  const dragHint = () => screen.queryByTitle("Drag to pop out into a window");

  // Drags the header `distance` pixels to the right, then lets go.
  const dragHeader = async (distance: number) => {
    const title = await screen.findByRole("heading", { name: "Git Buddy" });
    fireEvent.mouseDown(title, { clientX: 100, clientY: 20 });
    fireEvent.mouseMove(window, { clientX: 100 + distance, clientY: 20 });
    fireEvent.mouseUp(window);
  };

  it("pops out when the header is dragged, only in the Mac app's dropdown", async () => {
    const invoke = stubTauri();
    fakeApi(listApi());
    renderApp("/?shell=tray");
    await dragHeader(10);
    expect(callsOf(invoke, "pop_out")).toHaveLength(0);
    await dragHeader(30);
    expect(callsOf(invoke, "pop_out")).toHaveLength(1);
    cleanup();

    renderApp("/?shell=window");
    await dragHeader(30);
    expect(dragHint()).toBe(null);
    expect(callsOf(invoke, "pop_out")).toHaveLength(1);
  });

  it("doesn't pop out when a header button is dragged", async () => {
    const invoke = stubTauri();
    fakeApi(listApi());
    renderApp("/?shell=tray");
    const refresh = await screen.findByRole("button", { name: "Refresh" });
    fireEvent.mouseDown(refresh, { clientX: 100, clientY: 20 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 20 });
    expect(callsOf(invoke, "pop_out")).toHaveLength(0);
  });

  it("refreshes from the menu bar's Refresh", async () => {
    const fetch = fakeApi(
      listApi({ "POST /api/sync": () => json({ queued: true }, 202) }),
    );
    renderApp("/?shell=tray");
    await screen.findByText("Nothing needs you right now");

    act(() => {
      window.dispatchEvent(new Event("pr-peek:refresh"));
    });
    await waitFor(() => expect(callsTo(fetch, "/api/sync")).toHaveLength(1));
  });

  it("stays on after visiting settings", async () => {
    stubTauri();
    fakeApi(listApi());
    renderApp("/?shell=tray");
    await userEvent.click(
      await screen.findByRole("link", { name: "Settings" }),
    );
    await userEvent.click(
      await screen.findByRole("link", { name: "Back to your list" }),
    );
    await screen.findByText("Nothing needs you right now");
    expect(dragHint()).toBeTruthy();
  });
});

describe("empty and error states", () => {
  it("says when nothing needs you", async () => {
    fakeApi(listApi());
    renderApp("/");
    expect(await screen.findByText("Nothing needs you right now")).toBeTruthy();
  });

  it("asks for repos when none are watched", async () => {
    fakeApi(listApi({ "GET /api/repos": () => json({ repos: [] }) }));
    renderApp("/");
    expect(
      await screen.findByText("You're not watching any repos yet"),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "settings" }).getAttribute("href"),
    ).toBe("/settings/repos");
  });

  it("offers a retry when the list can't load", async () => {
    let down = true;
    fakeApi(
      listApi({
        "GET /api/items": () =>
          down
            ? apiError(500, "internal_error", "Server error")
            : json(groups()),
      }),
    );
    renderApp("/");

    expect(await screen.findByText(/Couldn't load your list/)).toBeTruthy();
    down = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing needs you right now")).toBeTruthy();
  });
});

describe("banners", () => {
  it.each([
    [{ me: me({ needsReauth: true }) }, "Reconnect GitHub"],
    [
      {
        me: me({
          githubToken: { expiresAt: null, scopes: [], invalid: true },
        }),
      },
      "Add a new token",
    ],
    [{ status: syncStatus({ syncError: "failed" }) }, /Sync problem/],
  ])("shows %o", async (state, text) => {
    fakeApi(
      listApi({
        "GET /api/me": () => json("me" in state ? state.me : me()),
        "GET /api/sync/status": () =>
          json("status" in state ? state.status : syncStatus()),
      }),
    );
    renderApp("/");
    expect(await screen.findByText(text)).toBeTruthy();
  });
});

describe("the header", () => {
  it("shows when the list last synced", async () => {
    const lastSyncedAt = minutesAgo(3);
    fakeApi(
      listApi({
        "GET /api/sync/status": () => json(syncStatus({ lastSyncedAt })),
      }),
    );
    renderApp("/");
    expect(await screen.findByText("Updated 3m ago")).toBeTruthy();
  });

  it("says when it hasn't synced yet", async () => {
    fakeApi(listApi());
    renderApp("/");
    expect(await screen.findByText("Not synced yet")).toBeTruthy();
  });

  it("refreshes and spins until the sync ends", async () => {
    let synced = minutesAgo(5);
    fakeApi(
      listApi({
        "GET /api/sync/status": () =>
          json(syncStatus({ lastSyncedAt: synced })),
        "POST /api/sync": () => json({ queued: true }, 202),
      }),
    );
    renderApp("/");
    await screen.findByText("Updated 5m ago");

    const refresh = screen.getByRole("button", { name: "Refresh" });
    await userEvent.click(refresh);
    expect(refresh.getAttribute("aria-busy")).toBe("true");

    // The worker finishes. The next check, 2 seconds later, sees it.
    synced = minutesAgo(0);
    expect(
      await screen.findByText("Updated just now", {}, { timeout: 4000 }),
    ).toBeTruthy();
    expect(refresh.getAttribute("aria-busy")).toBe("false");
  });

  // How far a pull must go is tested in PullToRefresh.test.tsx.
  describe("pull to refresh", () => {
    it("refreshes when the list is pulled down", async () => {
      const fetch = fakeApi(
        listApi({ "POST /api/sync": () => json({ queued: true }, 202) }),
      );
      renderApp("/");
      pull(
        await screen.findByText("Nothing needs you right now"),
        PULL_FAR_ENOUGH,
      );
      await waitFor(() => expect(callsTo(fetch, "/api/sync")).toHaveLength(1));
      expect(
        screen
          .getByRole("button", { name: "Refresh" })
          .getAttribute("aria-busy"),
      ).toBe("true");
    });

    // Like a finger that opened the preview with a long press, then moves down. The
    // sheet keeps its own touches, so those are left out.
    it("doesn't refresh while a preview is open", async () => {
      const asked = item();
      const fetch = fakeApi(
        listApi({
          "GET /api/items": () => json(groups({ review: [asked] })),
          ...previewApi(asked),
          "POST /api/sync": () => json({ queued: true }, 202),
        }),
      );
      renderApp("/");
      await sectionButton(/Needs my review/);
      const row = rowOf(asked);
      fireEvent.contextMenu(row);
      await screen.findByRole("dialog", { name: asked.pr.title });

      pull(row, 200);
      await settle();
      expect(callsTo(fetch, "/api/sync")).toHaveLength(0);
    });
  });

  it("shows why a refresh was refused in a toast", async () => {
    fakeApi(
      listApi({
        "POST /api/sync": () =>
          apiError(429, "rate_limited", "Wait a moment and try again"),
      }),
    );
    renderApp("/");
    await userEvent.click(
      await screen.findByRole("button", { name: "Refresh" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Wait a moment and try again",
      ),
    );
    expect(screen.queryByRole("alert")).toBe(null);
    expect(
      screen.getByRole("button", { name: "Refresh" }).getAttribute("aria-busy"),
    ).toBe("false");
  });

  it("shows the token banner when a refresh finds the token stopped working", async () => {
    let invalid = false;
    fakeApi(
      listApi({
        "GET /api/me": () =>
          json(
            me({
              githubToken: invalid
                ? { expiresAt: null, scopes: [], invalid: true }
                : null,
            }),
          ),
        "POST /api/sync": () => {
          invalid = true;
          return apiError(401, "token_invalid", "Your GitHub token stopped");
        },
      }),
    );
    renderApp("/");
    await userEvent.click(
      await screen.findByRole("button", { name: "Refresh" }),
    );
    expect(await screen.findByText("Add a new token")).toBeTruthy();
    // The banner says it, so no toast too.
    expect(screen.queryByText("Your GitHub token stopped")).toBe(null);
  });
});
