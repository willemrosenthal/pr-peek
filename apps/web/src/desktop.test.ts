import { describe, expect, it, vi } from "vitest";
import {
  setTrayState,
  startDesktop,
  trayIcon,
  trayTitle,
  updateReady,
  type CountStyle,
} from "./desktop";
import { summary } from "./test/fake-api";
import { callsOf, stubTauri } from "./test/tauri";
import { clickLink } from "./test/clicks";

describe("the menu bar", () => {
  const counts = summary({ total: 7, review: 3, replies: 1, mine: 3 });

  it.each<[CountStyle, string]>([
    ["total", "7"],
    ["split", "3 · 1 · 3"],
    ["dot", "•"],
    ["none", ""],
  ])("shows the %s count as %o", (style, title) => {
    expect(trayTitle(counts, style)).toBe(title);
  });

  it("adds the assigned count to the split count only when there is one", () => {
    const assigned = summary({ ...counts, total: 9, assigned: 2 });
    expect(trayTitle(assigned, "split")).toBe("3 · 1 · 2 · 3");
  });

  it("shows nothing when nothing is open", () => {
    expect(trayTitle(summary({ total: 0 }), "dot")).toBe("");
  });

  it("colors the icon for failing checks over late reviews", () => {
    const failing = summary({ hasStale: true, hasFailing: true });
    expect(trayIcon(summary(), true)).toBe("plain");
    expect(trayIcon(summary({ hasStale: true }), true)).toBe("stale");
    expect(trayIcon(failing, true)).toBe("failing");
    expect(trayIcon(failing, false)).toBe("plain");
  });

  it("sends the state to the app, and nothing in a browser", () => {
    setTrayState(counts, "total", true);
    const invoke = stubTauri();
    setTrayState(counts, "split", true);
    expect(callsOf(invoke, "set_tray_state")).toEqual([
      { state: { title: "3 · 1 · 3", icon: "plain" } },
    ]);
  });
});

describe("updateReady", () => {
  it("says no in a browser, and in app versions from before updates", async () => {
    expect(await updateReady()).toBe(false);
    stubTauri({ update_ready: new Error("unknown command") });
    expect(await updateReady()).toBe(false);
  });
});

describe("startDesktop", () => {
  it("opens new window and other site links in the browser", () => {
    const invoke = stubTauri();
    const stop = startDesktop();
    try {
      const pr = "https://github.com/acme/web-app/pull/7";
      expect(clickLink(pr, "_blank")).toBe(true);
      expect(clickLink(pr)).toBe(true);
      expect(clickLink(pr, "_blank", true)).toBe(true);
      expect(clickLink("/settings")).toBe(false);
      expect(callsOf(invoke, "open_external")).toEqual([
        { url: pr, background: false },
        { url: pr, background: false },
        { url: pr, background: true },
      ]);
    } finally {
      stop();
    }
  });

  it("shows notifications from the server natively", () => {
    const invoke = stubTauri();
    const stop = startDesktop();
    try {
      const payload = { title: "t", body: "b", url: "/x", tag: "i", badge: 3 };
      window.dispatchEvent(
        new CustomEvent("pr-peek:notify", { detail: payload }),
      );
      expect(callsOf(invoke, "notify")).toEqual([
        { alert: { title: "t", body: "b", url: "/x" } },
      ]);
    } finally {
      stop();
    }
  });

  it("does nothing in a browser", () => {
    const stop = startDesktop();
    expect(clickLink("https://github.com", "_blank")).toBe(false);
    stop();
  });

  it("marks the page for the app's styles, and shows the scrollbar while scrolling", () => {
    stubTauri();
    vi.useFakeTimers();
    const root = document.documentElement;
    const stop = startDesktop();
    try {
      expect(root.classList.contains("desktop-app")).toBe(true);
      expect(root.classList.contains("scrolling")).toBe(false);
      document.body.dispatchEvent(new Event("scroll"));
      expect(root.classList.contains("scrolling")).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(root.classList.contains("scrolling")).toBe(false);

      window.dispatchEvent(new Event("pr-peek:hidden"));
      expect(root.classList.contains("app-hidden")).toBe(true);
      window.dispatchEvent(new Event("pr-peek:shown"));
      expect(root.classList.contains("app-hidden")).toBe(false);
    } finally {
      stop();
      vi.useRealTimers();
    }
    expect(root.classList.contains("desktop-app")).toBe(false);
  });

  it("hides focus rings until a key is pressed, again each time the window opens", () => {
    stubTauri();
    const root = document.documentElement;
    const quiet = () => root.classList.contains("quiet-focus");
    const stop = startDesktop();
    try {
      expect(quiet()).toBe(true);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
      expect(quiet()).toBe(false);
      window.dispatchEvent(new Event("pr-peek:shown"));
      expect(quiet()).toBe(true);
    } finally {
      stop();
    }
    expect(quiet()).toBe(false);
  });

  it("rounds the dropdown after a reload that lost ?shell=tray", () => {
    stubTauri();
    sessionStorage.setItem("pr-peek:shell", "tray");
    const stop = startDesktop();
    expect(document.documentElement.classList.contains("dropdown")).toBe(true);
    stop();
  });

  it("keeps the rounded dropdown after signing in, which loses ?shell=tray", () => {
    stubTauri();
    const root = document.documentElement;
    // The app opens on the sign in page, which doesn't read the shell itself.
    history.replaceState(null, "", "/signin?shell=tray");
    startDesktop()();
    // GitHub sends the user back to a fresh page, without it.
    history.replaceState(null, "", "/onboarding");
    const stop = startDesktop();
    try {
      expect(root.classList.contains("dropdown")).toBe(true);
    } finally {
      stop();
      history.replaceState(null, "", "/");
    }
  });

  it("says when the Mac wakes from sleep", () => {
    stubTauri();
    vi.useFakeTimers();
    const woke = vi.fn();
    window.addEventListener("pr-peek:wake", woke);
    const stop = startDesktop();
    try {
      vi.advanceTimersByTime(60_000);
      expect(woke).not.toHaveBeenCalled();
      // The clock jumps, as it does after sleep.
      vi.setSystemTime(Date.now() + 10 * 60_000);
      vi.advanceTimersByTime(30_000);
      expect(woke).toHaveBeenCalledOnce();
    } finally {
      stop();
      window.removeEventListener("pr-peek:wake", woke);
      vi.useRealTimers();
    }
  });
});
