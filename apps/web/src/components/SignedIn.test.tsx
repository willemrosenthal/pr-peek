import {
  ITEMS_CHANGED_EVENT,
  NOTIFY_EVENT,
  type PushSubscriptionDto,
} from "@pr-peek/core";
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
import { coloredIcon, countStyle, HEARTBEAT_MS } from "../desktop";
import { RECONNECT_MS } from "../hooks/useLiveUpdates";
import {
  apiError,
  callsTo,
  device,
  fakeApi,
  type Handlers,
  json,
  listApi,
  me,
  noContent,
  sentBodies,
  signedInApi,
  signedOut,
  summary,
} from "../test/fake-api";
import { stubUserAgent, USER_AGENTS } from "../test/install";
import { stubPush, SUBSCRIPTION_KEYS, THIS_ENDPOINT } from "../test/push";
import { FakeEventSource, latestStream } from "../test/fake-stream";
import { renderApp } from "../test/render";
import { callsOf, stubTauri } from "../test/tauri";

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

  it("passes notifications for the Mac menu bar app on to the page", async () => {
    await renderList();
    const received = vi.fn();
    window.addEventListener("pr-peek:notify", received);
    try {
      const payload = { title: "t", body: "b", url: "/", tag: "x" };
      await send(
        new MessageEvent(NOTIFY_EVENT, { data: JSON.stringify(payload) }),
      );
      expect((received.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(
        payload,
      );
    } finally {
      window.removeEventListener("pr-peek:notify", received);
    }
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

  it.each(["pr-peek:wake", "online"])(
    "opens a new stream on %s, and catches up",
    async (event) => {
      const fetch = await renderList();
      const first = latestStream();
      await send(new Event("open"));

      act(() => {
        window.dispatchEvent(new Event(event));
      });
      expect(first.readyState).toBe(FakeEventSource.CLOSED);
      expect(FakeEventSource.opened).toHaveLength(2);
      await send(new Event("open"));
      await waitFor(() => expect(callsTo(fetch, "/api/items")).toHaveLength(2));
    },
  );

  it("closes the stream when the page goes", async () => {
    await renderList();
    cleanup();
    expect(latestStream().readyState).toBe(FakeEventSource.CLOSED);
  });
});

describe("the Mac menu bar", () => {
  it("shows the count, follows the stream, and switches style at once", async () => {
    const invoke = stubTauri();
    fakeApi(
      listApi({
        "GET /api/summary": () =>
          json(summary({ total: 4, review: 3, mine: 1 })),
      }),
    );
    renderApp("/");
    const shown = () =>
      callsOf(invoke, "set_tray_state").map(
        (args) => (args as { state: { title: string } }).state.title,
      );
    await waitFor(() => expect(shown().at(-1)).toBe("4"));

    await itemsChanged(5);
    await waitFor(() => expect(shown().at(-1)).toBe("5"));

    act(() => countStyle.set("dot"));
    expect(shown().at(-1)).toBe("•");
  });

  it("keeps the icon plain with the colored icon off", async () => {
    const invoke = stubTauri();
    fakeApi(
      listApi({
        "GET /api/summary": () =>
          json(summary({ total: 1, review: 1, hasFailing: true })),
      }),
    );
    renderApp("/");
    const icon = () =>
      callsOf(invoke, "set_tray_state").map(
        (args) => (args as { state: { icon: string } }).state.icon,
      );
    await waitFor(() => expect(icon().at(-1)).toBe("failing"));

    act(() => coloredIcon.set(false));
    expect(icon().at(-1)).toBe("plain");
  });

  it("tells the server it's running, every minute, only inside the app", async () => {
    const fetch = fakeApi(listApi());
    renderApp("/");
    await screen.findByText("Nothing needs you right now");
    expect(callsTo(fetch, "/api/desktop/heartbeat")).toEqual([]);
    cleanup();

    // Real time still passes, so the page can load.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stubTauri();
      renderApp("/");
      await waitFor(() =>
        expect(callsTo(fetch, "/api/desktop/heartbeat")).toHaveLength(1),
      );
      await act(() => vi.advanceTimersByTimeAsync(HEARTBEAT_MS));
      expect(callsTo(fetch, "/api/desktop/heartbeat")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the count and color on sign out", async () => {
    const invoke = stubTauri();
    let signedIn = true;
    fakeApi(
      signedInApi({
        "GET /api/me": () => (signedIn ? json(me()) : signedOut()),
        "GET /api/summary": () => json(summary({ total: 4, hasFailing: true })),
        "POST /api/auth/signout": () => {
          signedIn = false;
          return noContent();
        },
      }),
    );
    renderApp("/settings/account");
    await waitFor(() =>
      expect(callsOf(invoke, "set_tray_state")).toHaveLength(1),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Sign out" }),
    );
    await screen.findByRole("link", { name: "Sign in with GitHub" });
    expect(callsOf(invoke, "set_tray_state").at(-1)).toEqual({
      state: { title: "", icon: "plain" },
    });
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
    renderApp("/settings/account");
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

describe("checking this device's notifications on open", () => {
  const OLD_ENDPOINT = "https://fcm.googleapis.com/fcm/send/old";

  // The list, with a server holding `devices`.
  const withDevices = (
    devices: PushSubscriptionDto[],
    overrides: Handlers = {},
  ) =>
    fakeApi(
      listApi({
        "GET /api/push/subscriptions": () => json({ subscriptions: devices }),
        ...overrides,
      }),
    );

  it("moves the device when the browser changed its subscription", async () => {
    stubPush({ subscribed: THIS_ENDPOINT });
    localStorage.setItem("push-endpoint", OLD_ENDPOINT);
    const mac = device({ endpoint: OLD_ENDPOINT, label: "Mac" });
    const fetch = withDevices([mac], {
      [`PATCH /api/push/subscriptions/${mac.id}`]: () => {
        mac.endpoint = THIS_ENDPOINT;
        return json({ subscription: mac });
      },
    });
    renderApp("/");

    await waitFor(() =>
      expect(localStorage.getItem("push-endpoint")).toBe(THIS_ENDPOINT),
    );
    expect(
      sentBodies(fetch, `PATCH /api/push/subscriptions/${mac.id}`),
    ).toEqual([
      {
        onMac: false,
        subscription: { endpoint: THIS_ENDPOINT, keys: SUBSCRIPTION_KEYS },
      },
    ]);
  });

  it("leaves a device removed from another device removed", async () => {
    stubPush({ subscribed: THIS_ENDPOINT });
    localStorage.setItem("push-endpoint", OLD_ENDPOINT);
    const fetch = withDevices([]);
    renderApp("/");

    await waitFor(() =>
      expect(callsTo(fetch, "/api/push/subscriptions")).toHaveLength(1),
    );
    await screen.findByText("Nothing needs you right now");
    expect(sentBodies(fetch, "POST /api/push/subscriptions")).toEqual([]);
  });

  it("tells the server once whether an older device is on a Mac", async () => {
    stubUserAgent(USER_AGENTS.macSafari);
    stubPush({ subscribed: THIS_ENDPOINT });
    const mac = device({ endpoint: THIS_ENDPOINT });
    const fetch = withDevices([mac], {
      [`PATCH /api/push/subscriptions/${mac.id}`]: () =>
        json({ subscription: mac }),
    });
    renderApp("/");

    await waitFor(() =>
      expect(localStorage.getItem("push-endpoint")).toBe(THIS_ENDPOINT),
    );
    expect(
      sentBodies(fetch, `PATCH /api/push/subscriptions/${mac.id}`),
    ).toEqual([{ onMac: true }]);
    cleanup();

    // Already told, so opening again checks nothing.
    renderApp("/");
    await screen.findByText("Nothing needs you right now");
    expect(callsTo(fetch, "/api/push/subscriptions")).toHaveLength(1);
  });
});
