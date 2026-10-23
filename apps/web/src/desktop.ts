import type { PushPayload, SummaryResponse } from "@pr-peek/core";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { inTray } from "./hooks/useIsTray";

// The Mac menu bar app (apps/desktop). Everything here does nothing in a browser. The
// native side fires `pr-peek:hidden` and `pr-peek:refresh` on `window`. This module
// fires `pr-peek:wake`, and shows each `pr-peek:notify` from the live stream.

export const inDesktopApp = () => isTauri();

// Calls a command in apps/desktop/src-tauri/src/lib.rs. Failures don't matter to the page.
function call(command: string, args?: Record<string, unknown>) {
  if (!isTauri()) return;
  invoke(command, args).catch(() => undefined);
}

// The text next to the menu bar icon.
export type CountStyle = "total" | "split" | "dot" | "none";

export const COUNT_STYLES: { value: CountStyle; label: string }[] = [
  { value: "total", label: "Total, like 7" },
  { value: "split", label: "Each section, like 3 · 1 · 3" },
  { value: "dot", label: "A dot" },
  { value: "none", label: "Nothing, just the icon" },
];

export function trayTitle(summary: SummaryResponse, style: CountStyle) {
  if (summary.total === 0 || style === "none") return "";
  if (style === "dot") return "•";
  if (style === "split") {
    return [summary.review, summary.replies, summary.mine].join(" · ");
  }
  return String(summary.total);
}

// A failing check shows over a late review.
export const trayIcon = (summary: SummaryResponse) =>
  summary.hasFailing ? "failing" : summary.hasStale ? "stale" : "plain";

const sendTrayState = (title: string, icon: ReturnType<typeof trayIcon>) =>
  call("set_tray_state", { state: { title, icon } });

export const setTrayState = (summary: SummaryResponse, style: CountStyle) =>
  sendTrayState(trayTitle(summary, style), trayIcon(summary));

// Leaves just the plain icon, as after signing out.
export const clearTrayState = () => sendTrayState("", "plain");

export const openExternal = (url: string) => call("open_external", { url });
export const quitApp = () => call("quit_app");

// Whether the app opens when the user logs in to the Mac.
export const launchAtLogin = () => invoke<boolean>("launch_at_login");
export const setLaunchAtLogin = (on: boolean) =>
  invoke("set_launch_at_login", { on });

// The count style, kept on this Mac. One copy, so the tray and Settings stay in step.
const STYLE_KEY = "pr-peek:count-style";
const styleListeners = new Set<() => void>();

export function getCountStyle(): CountStyle {
  try {
    const stored = localStorage.getItem(STYLE_KEY);
    return COUNT_STYLES.some(({ value }) => value === stored)
      ? (stored as CountStyle)
      : "total";
  } catch {
    return "total";
  }
}

export function setCountStyle(style: CountStyle) {
  try {
    localStorage.setItem(STYLE_KEY, style);
  } catch {
    // Private storage can be blocked. The tray keeps the old style next time.
  }
  for (const listener of styleListeners) listener();
}

export function subscribeCountStyle(listener: () => void) {
  styleListeners.add(listener);
  return () => styleListeners.delete(listener);
}

// Links that would open a new window open in the default browser instead.
function openLinksInBrowser(event: MouseEvent) {
  const link = (event.target as Element | null)?.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement)) return;
  const external = new URL(link.href).origin !== location.origin;
  if (link.target !== "_blank" && !external) return;
  event.preventDefault();
  openExternal(link.href);
}

// Timers stop while the Mac sleeps, so a long gap between ticks means it woke up.
const WAKE_CHECK_MS = 30_000;

function watchForWake() {
  let last = Date.now();
  return setInterval(() => {
    const now = Date.now();
    if (now - last > WAKE_CHECK_MS * 3) {
      window.dispatchEvent(new Event("pr-peek:wake"));
    }
    last = now;
  }, WAKE_CHECK_MS);
}

// How long the scrollbar stays after scrolling stops.
const SCROLLBAR_MS = 800;

// Marks the page while it scrolls, so the scrollbar only shows then.
function showScrollbarWhileScrolling() {
  const root = document.documentElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onScroll = () => {
    root.classList.add("scrolling");
    clearTimeout(timer);
    timer = setTimeout(() => root.classList.remove("scrolling"), SCROLLBAR_MS);
  };
  // Scroll events don't bubble, so this catches every scroller on the way down.
  document.addEventListener("scroll", onScroll, true);
  return () => {
    document.removeEventListener("scroll", onScroll, true);
    clearTimeout(timer);
    root.classList.remove("scrolling");
  };
}

// A native Mac notification, instead of a push to the browsers on this Mac.
function showNotification(event: Event) {
  const { title, body, url } = (event as CustomEvent<PushPayload>).detail;
  call("notify", { alert: { title, body, url } });
}

// Run once at startup. Returns a function that stops it, for tests.
export function startDesktop(): () => void {
  if (!isTauri()) return () => undefined;
  // Styles for the Mac app. The dropdown under the icon also gets rounded corners.
  const root = document.documentElement;
  root.classList.add("desktop-app");
  root.classList.toggle("dropdown", inTray());
  document.addEventListener("click", openLinksInBrowser, true);
  window.addEventListener("pr-peek:notify", showNotification);
  const wake = watchForWake();
  const stopScrollbar = showScrollbarWhileScrolling();
  return () => {
    root.classList.remove("desktop-app", "dropdown");
    document.removeEventListener("click", openLinksInBrowser, true);
    window.removeEventListener("pr-peek:notify", showNotification);
    clearInterval(wake);
    stopScrollbar();
  };
}

// While the app runs, the server sends it notifications instead of the browsers on this
// Mac. It counts as running for a few minutes after each of these.
export const HEARTBEAT_MS = 60_000;
