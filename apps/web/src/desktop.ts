import type { SummaryResponse } from "@pr-peek/core";
import { invoke, isTauri } from "@tauri-apps/api/core";

// The Mac menu bar app (apps/desktop). Everything here does nothing in a browser. The
// native side fires `pr-peek:hidden` and `pr-peek:refresh` on `window`. This module
// fires `pr-peek:wake`.

export const inDesktopApp = () => isTauri();

// Calls a command in apps/desktop/src-tauri/src/lib.rs. Failures don't matter to the page.
function call(command: string, args?: Record<string, unknown>) {
  if (!isTauri()) return;
  invoke(command, args).catch(() => undefined);
}

// The text next to the menu bar icon.
export type CountStyle = "total" | "split" | "dot";

export const COUNT_STYLES: { value: CountStyle; label: string }[] = [
  { value: "total", label: "Total, like 7" },
  { value: "split", label: "Each section, like 3 · 1 · 3" },
  { value: "dot", label: "A dot" },
];

export function trayTitle(summary: SummaryResponse, style: CountStyle) {
  if (summary.total === 0) return "";
  if (style === "dot") return "•";
  if (style === "split") {
    return [summary.review, summary.replies, summary.mine].join(" · ");
  }
  return String(summary.total);
}

// A failing check shows over a late review.
export const trayIcon = (summary: SummaryResponse) =>
  summary.hasFailing ? "failing" : summary.hasStale ? "stale" : "plain";

export function setTrayState(summary: SummaryResponse, style: CountStyle) {
  call("set_tray_state", {
    state: { title: trayTitle(summary, style), icon: trayIcon(summary) },
  });
}

export const openExternal = (url: string) => call("open_external", { url });
export const quitApp = () => call("quit_app");

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

// Run once at startup. Returns a function that stops it, for tests.
export function startDesktop(): () => void {
  if (!isTauri()) return () => undefined;
  document.addEventListener("click", openLinksInBrowser, true);
  const wake = watchForWake();
  return () => {
    document.removeEventListener("click", openLinksInBrowser, true);
    clearInterval(wake);
  };
}
