import { cleanup, screen } from "@testing-library/react";
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
  syncStatus,
} from "../test/fake-api";
import { renderApp } from "../test/render";

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
