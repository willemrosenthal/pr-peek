import type { PushPayload, SummaryResponse } from "@pr-peek/core";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { inDropdown, rememberShell } from "./hooks/useIsTray";
import { localSetting } from "./localSetting";

// The Mac menu bar app (apps/desktop). Everything here does nothing in a browser. The
// native side fires `pr-peek:hidden`, `pr-peek:shown`, `pr-peek:refresh`, and
// `pr-peek:update-ready` on `window`. This module fires `pr-peek:wake`, and shows each `pr-peek:notify` from the
// live stream.

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
    // Assigned only when there is one, so teams that don't use assignees keep three.
    const assigned = summary.assigned > 0 ? [summary.assigned] : [];
    return [summary.review, summary.replies, ...assigned, summary.mine].join(
      " · ",
    );
  }
  return String(summary.total);
}

// A failing check shows over a late review. With `colored` off, the icon stays plain.
export function trayIcon(summary: SummaryResponse, colored: boolean) {
  if (!colored) return "plain";
  return summary.hasFailing ? "failing" : summary.hasStale ? "stale" : "plain";
}

const sendTrayState = (title: string, icon: ReturnType<typeof trayIcon>) =>
  call("set_tray_state", { state: { title, icon } });

export const setTrayState = (
  summary: SummaryResponse,
  style: CountStyle,
  colored: boolean,
) => sendTrayState(trayTitle(summary, style), trayIcon(summary, colored));

// Leaves just the plain icon, as after signing out.
export const clearTrayState = () => sendTrayState("", "plain");

// `background` keeps the browser behind Git Buddy, for Cmd+click.
export const openExternal = (url: string, background = false) =>
  call("open_external", { url, background });
// Turns the dropdown into a normal window. Closing the window puts it back.
export const popOut = () => call("pop_out");

// Whether the app opens when the user logs in to the Mac.
export const launchAtLogin = () => invoke<boolean>("launch_at_login");
export const setLaunchAtLogin = (on: boolean) =>
  invoke("set_launch_at_login", { on });

// Whether a new version of the Mac app has installed and waits for a restart. Versions
// from before updates don't know the command, so they answer no.
export const updateReady = () =>
  isTauri()
    ? invoke<boolean>("update_ready").catch(() => false)
    : Promise.resolve(false);
export const restartToUpdate = () => call("restart_to_update");

// Menu bar settings, kept on this Mac.
export const countStyle = localSetting<CountStyle>(
  "pr-peek:count-style",
  "total",
  (value): value is CountStyle =>
    COUNT_STYLES.some((style) => style.value === value),
);

// Whether the icon turns orange for late reviews and red for failing checks.
export const coloredIcon = localSetting<boolean>(
  "pr-peek:colored-icon",
  true,
  (value): value is boolean => typeof value === "boolean",
);

// Links that would open a new window open in the default browser instead.
function openLinksInBrowser(event: MouseEvent) {
  const link = (event.target as Element | null)?.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement)) return;
  const external = new URL(link.href).origin !== location.origin;
  if (link.target !== "_blank" && !external) return;
  event.preventDefault();
  openExternal(link.href, event.metaKey);
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

// macOS can focus the first button when the window opens. Its ring stays hidden until
// the user presses a key.
const quietFocus = () => document.documentElement.classList.add("quiet-focus");
const showFocus = () =>
  document.documentElement.classList.remove("quiet-focus");

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
  rememberShell();
  root.classList.add("desktop-app");
  root.classList.toggle("dropdown", inDropdown());
  // Marks the page while the window is hidden, so animations can pause.
  const onHidden = () => root.classList.add("app-hidden");
  const onShown = () => {
    root.classList.remove("app-hidden");
    quietFocus();
  };
  quietFocus();
  document.addEventListener("keydown", showFocus, true);
  document.addEventListener("click", openLinksInBrowser, true);
  window.addEventListener("pr-peek:notify", showNotification);
  window.addEventListener("pr-peek:hidden", onHidden);
  window.addEventListener("pr-peek:shown", onShown);
  const wake = watchForWake();
  const stopScrollbar = showScrollbarWhileScrolling();
  return () => {
    root.classList.remove(
      "desktop-app",
      "dropdown",
      "app-hidden",
      "quiet-focus",
    );
    document.removeEventListener("keydown", showFocus, true);
    document.removeEventListener("click", openLinksInBrowser, true);
    window.removeEventListener("pr-peek:notify", showNotification);
    window.removeEventListener("pr-peek:hidden", onHidden);
    window.removeEventListener("pr-peek:shown", onShown);
    clearInterval(wake);
    stopScrollbar();
  };
}

// While the app runs, the server sends it notifications instead of the browsers on this
// Mac. It counts as running for a few minutes after each of these.
export const HEARTBEAT_MS = 60_000;
