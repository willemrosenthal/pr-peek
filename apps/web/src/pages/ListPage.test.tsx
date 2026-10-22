import type { MarkSeenBody } from "@pr-peek/core";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  apiError,
  fakeApi,
  groups,
  item,
  json,
  listApi,
  me,
  noContent,
  sentBodies,
  syncStatus,
} from "../test/fake-api";
import { renderApp } from "../test/render";
import { setVisibility } from "../test/visibility";

const minutesAgo = (n: number) =>
  new Date(Date.now() - n * 60_000).toISOString();

const sectionButton = (name: RegExp) => screen.findByRole("button", { name });
const rows = () => screen.queryAllByRole("link", { name: /PR/ });

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
    expect(rows()).toHaveLength(3);
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
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(seenRequests(fetch)).toEqual([]);
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
  const trayFooter = () =>
    screen.queryByRole("link", { name: "Open in browser" });

  it("adds the footer in the menu bar app", async () => {
    fakeApi(listApi());
    renderApp("/?shell=tray");
    expect(
      await screen.findByRole("link", { name: "Open in browser" }),
    ).toBeTruthy();
  });

  it("has no footer in a browser", async () => {
    fakeApi(listApi());
    renderApp("/");
    await screen.findByText("Nothing needs you right now");
    expect(trayFooter()).toBe(null);
  });

  it("stays on after visiting settings", async () => {
    fakeApi(listApi());
    renderApp("/?shell=tray");
    await userEvent.click(
      await screen.findByRole("link", { name: "Settings" }),
    );
    await userEvent.click(
      await screen.findByRole("link", { name: "Back to your list" }),
    );
    await screen.findByText("Nothing needs you right now");
    expect(trayFooter()).toBeTruthy();
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

  it("shows why a refresh was refused", async () => {
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
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Wait a moment and try again",
    );
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
    expect(screen.queryByRole("alert")).toBe(null);
  });
});
