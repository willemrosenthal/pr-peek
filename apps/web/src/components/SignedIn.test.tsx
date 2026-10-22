import { ITEMS_CHANGED_EVENT } from "@pr-peek/core";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { RECONNECT_MS } from "../hooks/useLiveUpdates";
import {
  apiError,
  callsTo,
  fakeApi,
  json,
  listApi,
  me,
  noContent,
  signedInApi,
  signedOut,
  summary,
} from "../test/fake-api";
import { FakeEventSource, latestStream } from "../test/fake-stream";
import { renderApp } from "../test/render";

const send = (event: Event) => act(() => latestStream().dispatchEvent(event));
const itemsChanged = (total: number) =>
  send(
    new MessageEvent(ITEMS_CHANGED_EVENT, {
      data: JSON.stringify(summary({ total })),
    }),
  );

async function renderList() {
  const fetch = fakeApi(listApi());
  renderApp("/");
  await screen.findByText("Nothing needs you right now");
  return fetch;
}

describe("the live stream", () => {
  it("opens the stream once signed in", async () => {
    await renderList();
    expect(FakeEventSource.opened.map((s) => s.url)).toEqual(["/api/stream"]);
  });

  it("reloads the list when items change", async () => {
    const fetch = await renderList();
    expect(callsTo(fetch, "/api/items")).toHaveLength(1);

    await itemsChanged(2);
    await waitFor(() => expect(callsTo(fetch, "/api/items")).toHaveLength(2));
    expect(callsTo(fetch, "/api/sync/status")).toHaveLength(2);
  });

  it("catches up after a reconnect, but not on the first open", async () => {
    const fetch = await renderList();
    await send(new Event("open"));
    expect(callsTo(fetch, "/api/items")).toHaveLength(1);

    await send(new Event("open"));
    await waitFor(() => expect(callsTo(fetch, "/api/items")).toHaveLength(2));
    expect(callsTo(fetch, "/api/summary")).toHaveLength(2);
  });

  it("opens a new stream a while after the server closes it", async () => {
    await renderList();
    vi.useFakeTimers();
    try {
      latestStream().readyState = FakeEventSource.CLOSED;
      await send(new Event("error"));
      expect(FakeEventSource.opened).toHaveLength(1);
      await act(() => vi.advanceTimersByTimeAsync(RECONNECT_MS));
      expect(FakeEventSource.opened).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a signed out user to sign in when the stream is refused", async () => {
    let signedIn = true;
    fakeApi(
      listApi({ "GET /api/me": () => (signedIn ? json(me()) : signedOut()) }),
    );
    renderApp("/");
    await screen.findByText("Nothing needs you right now");

    signedIn = false;
    const stream = latestStream();
    stream.readyState = FakeEventSource.CLOSED;
    await send(new Event("error"));
    expect(
      await screen.findByRole("link", { name: "Sign in with GitHub" }),
    ).toBeTruthy();
    expect(stream.readyState).toBe(FakeEventSource.CLOSED);
  });

  it("keeps the list up when the server is down", async () => {
    let down = false;
    const fetch = fakeApi(
      listApi({
        "GET /api/me": () =>
          down ? apiError(503, "unavailable", "Server is down") : json(me()),
      }),
    );
    renderApp("/");
    await screen.findByText("Nothing needs you right now");
    const checks = callsTo(fetch, "/api/me").length;

    down = true;
    latestStream().readyState = FakeEventSource.CLOSED;
    await send(new Event("error"));
    // The check, then its two retries.
    await waitFor(() =>
      expect(callsTo(fetch, "/api/me")).toHaveLength(checks + 3),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(screen.queryByText("Server is down")).toBe(null);
    expect(screen.getByText("Nothing needs you right now")).toBeTruthy();
  });

  it("leaves dropped connections to the browser", async () => {
    const fetch = await renderList();
    const checks = callsTo(fetch, "/api/me").length;
    await send(new Event("error"));
    expect(callsTo(fetch, "/api/me")).toHaveLength(checks);
  });

  it("closes the stream when the page goes", async () => {
    await renderList();
    cleanup();
    expect(latestStream().readyState).toBe(FakeEventSource.CLOSED);
  });
});

describe("the app badge", () => {
  let setAppBadge: Mock<(count: number) => Promise<void>>;

  beforeEach(() => {
    setAppBadge = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "setAppBadge", {
      value: setAppBadge,
      configurable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "setAppBadge");
  });

  it("shows the count, and follows the live stream", async () => {
    fakeApi(listApi({ "GET /api/summary": () => json(summary({ total: 4 })) }));
    renderApp("/");
    await waitFor(() => expect(setAppBadge).toHaveBeenLastCalledWith(4));

    await itemsChanged(5);
    await waitFor(() => expect(setAppBadge).toHaveBeenLastCalledWith(5));
  });

  it("clears the badge on sign out", async () => {
    let signedIn = true;
    fakeApi(
      signedInApi({
        "GET /api/me": () => (signedIn ? json(me()) : signedOut()),
        "GET /api/summary": () => json(summary({ total: 4 })),
        "POST /api/auth/signout": () => {
          signedIn = false;
          return noContent();
        },
      }),
    );
    renderApp("/settings");
    await waitFor(() => expect(setAppBadge).toHaveBeenLastCalledWith(4));

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("link", { name: "Sign in with GitHub" });
    expect(setAppBadge).toHaveBeenLastCalledWith(0);
  });

  it("ignores a refused badge", async () => {
    setAppBadge.mockImplementation(() => Promise.reject(new Error("no")));
    await renderList();
    await waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(0));
  });
});
