import { afterEach, expect, it, vi } from "vitest";
import { startIos } from "./ios";
import { clickLink } from "./test/clicks";

const PR = "https://github.com/acme/web-app/pull/7";

// Opens the page as the iPhone app does.
const openAs = (search: string) => history.replaceState(null, "", `/${search}`);

afterEach(() => openAs(""));

it("opens PR and other site links in Safari in the iPhone app", () => {
  openAs("?shell=ios");
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const stop = startIos();
  try {
    expect(document.documentElement.classList.contains("ios-app")).toBe(true);
    expect(clickLink(PR)).toBe(true);
    expect(clickLink("/settings", "_blank")).toBe(true);
    // Its own pages stay in the app.
    expect(clickLink("/settings")).toBe(false);
    expect(open.mock.calls).toEqual([
      [PR, "_blank"],
      [`${location.origin}/settings`, "_blank"],
    ]);
  } finally {
    stop();
  }
  expect(document.documentElement.classList.contains("ios-app")).toBe(false);
});

it("remembers it's in the iPhone app after signing in drops the flag", () => {
  openAs("?shell=ios");
  startIos()();
  openAs("");
  const stop = startIos();
  try {
    expect(clickLink(PR)).toBe(true);
  } finally {
    stop();
  }
});

it("leaves links alone in a browser", () => {
  const stop = startIos();
  try {
    expect(clickLink(PR)).toBe(false);
  } finally {
    stop();
  }
});
