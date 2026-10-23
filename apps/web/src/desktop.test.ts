import { describe, expect, it, vi } from "vitest";
import {
  setTrayState,
  startDesktop,
  trayIcon,
  trayTitle,
  type CountStyle,
} from "./desktop";
import { summary } from "./test/fake-api";
import { callsOf, stubTauri } from "./test/tauri";

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

  it("shows nothing when nothing is open", () => {
    expect(trayTitle(summary({ total: 0 }), "dot")).toBe("");
  });

  it("colors the icon for failing checks over late reviews", () => {
    expect(trayIcon(summary())).toBe("plain");
    expect(trayIcon(summary({ hasStale: true }))).toBe("stale");
    expect(trayIcon(summary({ hasStale: true, hasFailing: true }))).toBe(
      "failing",
    );
  });

  it("sends the state to the app, and nothing in a browser", () => {
    setTrayState(counts, "total");
    const invoke = stubTauri();
    setTrayState(counts, "split");
    expect(callsOf(invoke, "set_tray_state")).toEqual([
      { state: { title: "3 · 1 · 3", icon: "plain" } },
    ]);
  });
});

describe("startDesktop", () => {
  // Clicks a link. True if pr-peek stopped the click. The test stops it after, since
  // jsdom can't load other pages.
  const clickLink = (href: string, target?: string) => {
    const link = document.createElement("a");
    link.href = href;
    if (target) link.target = target;
    document.body.append(link);
    let stopped = false;
    const after = (event: Event) => {
      stopped = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener("click", after);
    link.click();
    document.removeEventListener("click", after);
    link.remove();
    return stopped;
  };

  it("opens new window and other site links in the browser", () => {
    const invoke = stubTauri();
    const stop = startDesktop();
    try {
      const pr = "https://github.com/acme/web-app/pull/7";
      expect(clickLink(pr, "_blank")).toBe(true);
      expect(clickLink(pr)).toBe(true);
      expect(clickLink("/settings")).toBe(false);
      expect(callsOf(invoke, "open_external")).toEqual([
        { url: pr },
        { url: pr },
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
    } finally {
      stop();
      vi.useRealTimers();
    }
    expect(root.classList.contains("desktop-app")).toBe(false);
  });

  it("rounds the dropdown after a reload that lost ?shell=tray", () => {
    stubTauri();
    sessionStorage.setItem("pr-peek:shell", "tray");
    const stop = startDesktop();
    expect(document.documentElement.classList.contains("dropdown")).toBe(true);
    stop();
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
