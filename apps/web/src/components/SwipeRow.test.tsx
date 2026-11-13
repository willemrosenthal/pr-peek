import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { MouseEvent } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { haptic, ticks } from "../test/haptics";
import {
  drag,
  FAR_ENOUGH,
  hold,
  NOT_FAR_ENOUGH,
  stubPointerCapture,
} from "../test/swipe";
import { enterIosApp } from "../test/native";
import {
  LONG_PRESS_MS,
  PAST_ARMED_MAX_PX,
  ROW_GIVE,
  rowOffset,
  SWIPE_MIN_PX,
  SWIPE_SHARE,
  SwipeRow,
} from "./SwipeRow";
import styles from "./SwipeRow.module.css";

vi.mock("../haptics", () => import("../test/haptics"));

beforeAll(stubPointerCapture);
// For the timed swipes, which use fake timers.
afterEach(() => {
  vi.useRealTimers();
});

// Presses on `link`, then for each `[ms, dx]` waits `ms` and moves to `dx` across. Then
// waits `pause` ms and lets go. Needs fake timers, which time the moves.
function swipeTimed(link: Element, steps: [number, number][], pause = 0) {
  const at = (dx: number) => ({ pointerId: 1, clientX: 200 + dx, clientY: 20 });
  fireEvent.pointerDown(link, { button: 0, ...at(0) });
  let dx = 0;
  for (const [ms, to] of steps) {
    vi.advanceTimersByTime(ms);
    dx = to;
    fireEvent.pointerMove(link, at(dx));
  }
  vi.advanceTimersByTime(pause);
  fireEvent.pointerUp(link, at(dx));
}

// Moves `dx` across, then holds still before letting go. Speed only counts the last 50ms,
// so it's never a flick, however slow the machine running the test. Needs fake timers.
const slowDrag = (link: Element, dx: number) =>
  swipeTimed(
    link,
    [
      [100, dx / 2],
      [100, dx],
    ],
    100,
  );

// Short of `FAR_ENOUGH`, but quick: over 60ms, and `dx` / 52 px per ms at the end.
const flick = (dx: number): [number, number][] => [
  [30, (dx * 3) / 7],
  [30, dx],
];

function setup(quiet = false) {
  const onToggle = vi.fn();
  const onLinkClick = vi.fn((event: MouseEvent<HTMLAnchorElement>) =>
    event.preventDefault(),
  );
  render(
    <SwipeRow quiet={quiet} onToggle={onToggle}>
      <a href="https://github.com/acme/web-app/pull/7" onClick={onLinkClick}>
        Add login
      </a>
    </SwipeRow>,
  );
  const link = screen.getByRole("link", { name: "Add login" });
  return { onToggle, onLinkClick, link };
}

// Waits longer than a row takes to slide out.
const settle = () => new Promise((done) => setTimeout(done, 300));
// The same, for tests on fake timers.
const settleTimed = () => vi.advanceTimersByTimeAsync(300);

// The strip behind the row that says `label`, while it shows.
const strip = (label = "Quiet") =>
  screen.queryByText(label)?.parentElement ?? null;

describe("SwipeRow", () => {
  it.each([-FAR_ENOUGH, FAR_ENOUGH])(
    "quiets the PR when swiped %ipx, once",
    async (dx) => {
      const { onToggle, link } = setup();
      drag(link, dx);
      await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(1));
      // Slid out, so another swipe does nothing.
      drag(link, dx);
      await settle();
      expect(onToggle).toHaveBeenCalledTimes(1);
    },
  );

  it.each([-40, NOT_FAR_ENOUGH])(
    "springs back from a %ipx swipe",
    async (dx) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { onToggle, link } = setup();
      slowDrag(link, dx);
      await settleTimed();
      expect(onToggle).not.toHaveBeenCalled();
      expect(strip()).toBe(null);
    },
  );

  it("needs a longer swipe on a wider row", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const width = 600;
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(
      width,
    );
    const { onToggle, link } = setup();
    const acts = width * SWIPE_SHARE;
    expect(acts).toBeGreaterThan(FAR_ENOUGH);
    slowDrag(link, -FAR_ENOUGH);
    await settleTimed();
    expect(onToggle).not.toHaveBeenCalled();
    slowDrag(link, -(acts + 30));
    await settleTimed();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows when the row has gone far enough to quiet it", () => {
    const { link } = setup();
    hold(link, -NOT_FAR_ENOUGH);
    expect(strip()!.className).not.toContain(styles.armed);
    hold(link, -FAR_ENOUGH);
    expect(strip()!.className).toContain(styles.armed);
  });

  it("trails the finger a little", () => {
    const { link } = setup();
    hold(link, -NOT_FAR_ENOUGH);
    expect(link.parentElement!.style.transform).toBe(
      `translateX(${-NOT_FAR_ENOUGH * ROW_GIVE}px)`,
    );
  });

  it("doesn't open the link when a swipe ends", () => {
    const { onLinkClick, link } = setup();
    drag(link, -FAR_ENOUGH);
    fireEvent.click(link);
    expect(onLinkClick).not.toHaveBeenCalled();
    // Only that click is blocked.
    fireEvent.click(link);
    expect(onLinkClick).toHaveBeenCalledTimes(1);
  });

  it("lets a click elsewhere through right after a swipe, and still blocks its own", () => {
    // Like the hidden switch a haptic tick clicks on iPhones.
    const { onLinkClick, link } = setup();
    const other = vi.fn();
    document.body.addEventListener("click", other);
    drag(link, -FAR_ENOUGH);
    fireEvent.click(document.body);
    document.body.removeEventListener("click", other);
    expect(other).toHaveBeenCalledTimes(1);
    fireEvent.click(link);
    expect(onLinkClick).not.toHaveBeenCalled();
  });

  it("closes up after sliding out, then quiets", async () => {
    const { onToggle, link } = setup();
    const row = link.closest(`.${styles.swipe}`)!;
    drag(link, -FAR_ENOUGH);
    await waitFor(() => expect(row.className).toContain(styles.closing));
    expect(onToggle).not.toHaveBeenCalled();
    await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(1));
  });

  describe("a quick flick", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    it("quiets before it's gone far enough", async () => {
      const { onToggle, link } = setup();
      swipeTimed(link, flick(-NOT_FAR_ENOUGH));
      await settleTimed();
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    // Over the whole swipe it's still fast enough, so only the last moments count.
    it("doesn't count if the finger stopped before letting go", async () => {
      const { onToggle, link } = setup();
      swipeTimed(link, flick(-NOT_FAR_ENOUGH), 60);
      await settleTimed();
      expect(onToggle).not.toHaveBeenCalled();
    });

    it("doesn't count a flick back toward the start", async () => {
      const { onToggle, link } = setup();
      swipeTimed(link, [
        [30, -30],
        [300, -FAR_ENOUGH],
        [30, -NOT_FAR_ENOUGH],
      ]);
      await settleTimed();
      expect(onToggle).not.toHaveBeenCalled();
    });
  });

  it("ticks when a swipe acts, not when it springs back", () => {
    vi.useFakeTimers();
    haptic.mockClear();
    const { link } = setup();
    slowDrag(link, -40);
    expect(haptic).not.toHaveBeenCalled();
    drag(link, -FAR_ENOUGH);
    expect(ticks()).toEqual(["light"]);
  });

  it("ticks as a swipe gets far enough instead, in the iPhone app", () => {
    vi.useFakeTimers();
    haptic.mockClear();
    enterIosApp();
    const { onToggle, link } = setup();
    hold(link, -FAR_ENOUGH);
    expect(ticks()).toEqual(["light"]);
    fireEvent.pointerUp(link, { pointerId: 1 });
    vi.runAllTimers();
    // It acted, without a second tick.
    expect(onToggle).toHaveBeenCalled();
    expect(ticks()).toEqual(["light"]);
  });

  it("lets the list scroll when the move is mostly down", async () => {
    const { onToggle, link } = setup();
    drag(link, -FAR_ENOUGH, 400);
    await settle();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("quiets on a two-finger trackpad swipe", async () => {
    const { onToggle, link } = setup();
    fireEvent.wheel(link, { deltaX: FAR_ENOUGH / 2, deltaY: 2 });
    fireEvent.wheel(link, { deltaX: FAR_ENOUGH / 2, deltaY: 0 });
    await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(1));
  });

  it("springs back from a short trackpad swipe", async () => {
    const { onToggle, link } = setup();
    fireEvent.wheel(link, { deltaX: NOT_FAR_ENOUGH, deltaY: 0 });
    await settle();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("ignores vertical scrolling", async () => {
    const { onToggle, link } = setup();
    fireEvent.wheel(link, { deltaX: 10, deltaY: 200 });
    await settle();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("has no button on a row that isn't quiet", () => {
    setup();
    expect(screen.queryByRole("button")).toBe(null);
  });

  it("has a button that brings a quiet PR back", async () => {
    const { onToggle } = setup(true);
    await userEvent.click(screen.getByRole("button", { name: "Bring back" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("SwipeRow right swipe", () => {
  function setupImportant(important = false) {
    const onToggle = vi.fn();
    const onToggleImportant = vi.fn();
    render(
      <SwipeRow
        quiet={false}
        onToggle={onToggle}
        important={important}
        onToggleImportant={onToggleImportant}
      >
        <a href="https://github.com/acme/web-app/pull/7">Add login</a>
      </SwipeRow>,
    );
    const link = screen.getByRole("link", { name: "Add login" });
    return { onToggle, onToggleImportant, link };
  }

  it("marks the PR important, and the row stays to swipe again", async () => {
    const { onToggle, onToggleImportant, link } = setupImportant();
    drag(link, FAR_ENOUGH);
    expect(onToggleImportant).toHaveBeenCalledTimes(1);
    drag(link, FAR_ENOUGH);
    expect(onToggleImportant).toHaveBeenCalledTimes(2);
    await settle();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("flashes the row each time it marks it", () => {
    const { link } = setupImportant();
    const flash = () => link.parentElement!.querySelector(`.${styles.flash}`);
    drag(link, FAR_ENOUGH);
    const first = flash();
    expect(first).not.toBe(null);
    // A new one, so the flash starts over.
    drag(link, FAR_ENOUGH);
    expect(flash()).not.toBe(first);
  });

  it("marks the PR important on a quick flick right", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { onToggleImportant, link } = setupImportant();
    swipeTimed(link, flick(NOT_FAR_ENOUGH));
    expect(onToggleImportant).toHaveBeenCalledTimes(1);
  });

  it("still quiets when swiped left", async () => {
    const { onToggle, onToggleImportant, link } = setupImportant();
    drag(link, -FAR_ENOUGH);
    await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(1));
    expect(onToggleImportant).not.toHaveBeenCalled();
  });

  it("says Important in amber, filled once far enough", () => {
    const { link } = setupImportant();
    hold(link, 100);
    expect(strip("Important")!.className).toContain(styles.important);
    expect(strip("Important")!.className).not.toContain(styles.armed);
    hold(link, FAR_ENOUGH);
    expect(strip("Important")!.className).toContain(styles.armed);
  });

  it("says Remove flag when it's marked", () => {
    hold(setupImportant(true).link, 100);
    expect(screen.getByText("Remove flag")).toBeTruthy();
  });

  it("marks important on a trackpad swipe right", async () => {
    const { onToggleImportant, link } = setupImportant();
    fireEvent.wheel(link, { deltaX: -FAR_ENOUGH, deltaY: 0 });
    await waitFor(() => expect(onToggleImportant).toHaveBeenCalledTimes(1));
  });
});

describe("SwipeRow that unflags", () => {
  it.each([-100, 100])("says Remove flag in amber when swiped %ipx", (dx) => {
    render(
      <SwipeRow quiet={false} onToggle={vi.fn()} unflags>
        <a href="https://github.com/acme/web-app/pull/7">Add login</a>
      </SwipeRow>,
    );
    hold(screen.getByRole("link", { name: "Add login" }), dx);
    expect(strip("Remove flag")!.className).toContain(styles.important);
    expect(strip()).toBe(null);
  });
});

describe("SwipeRow in Watching", () => {
  const setupWatching = (unflags = false) => {
    render(
      <SwipeRow
        quiet={false}
        onToggle={vi.fn()}
        important
        watching
        unflags={unflags}
        onToggleImportant={unflags ? undefined : vi.fn()}
      >
        <a href="https://github.com/acme/web-app/pull/7">Add login</a>
      </SwipeRow>,
    );
    return screen.getByRole("link", { name: "Add login" });
  };

  it("says Stop watching, not Remove flag", () => {
    hold(setupWatching(), 100);
    expect(screen.getByText("Stop watching")).toBeTruthy();
    expect(screen.queryByText("Remove flag")).toBe(null);
  });

  it("says it either way on a merged row", () => {
    hold(setupWatching(true), -100);
    expect(screen.getByText("Stop watching")).toBeTruthy();
  });
});

describe("SwipeRow long press", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setupPress() {
    const onLongPress = vi.fn();
    const onPressStart = vi.fn();
    const onLinkClick = vi.fn((event: MouseEvent<HTMLAnchorElement>) =>
      event.preventDefault(),
    );
    render(
      <SwipeRow
        quiet={false}
        onToggle={() => {}}
        onLongPress={onLongPress}
        onPressStart={onPressStart}
      >
        <a href="https://github.com/acme/web-app/pull/7" onClick={onLinkClick}>
          Add login
        </a>
      </SwipeRow>,
    );
    const link = screen.getByRole("link", { name: "Add login" });
    return { onLongPress, onPressStart, onLinkClick, link };
  }

  const press = (el: Element) =>
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 200 });

  it("opens the preview after a held press, and not the link", () => {
    const { onLongPress, onPressStart, onLinkClick, link } = setupPress();
    press(link);
    vi.advanceTimersByTime(140);
    expect(onPressStart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(onPressStart).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(link, { pointerId: 1 });
    fireEvent.click(link);
    expect(onLinkClick).not.toHaveBeenCalled();
  });

  it.each([
    [true, ["firm"]],
    [false, []],
  ])("ticks firmly as it opens, in the iPhone app: %s", (inApp, expected) => {
    haptic.mockClear();
    if (inApp) enterIosApp();
    const { link } = setupPress();
    press(link);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(ticks()).toEqual(expected);
  });

  // True when nothing stopped the selection.
  const select = () =>
    fireEvent(document, new Event("selectstart", { cancelable: true }));

  it("blocks text selection from the long press until it's let go", () => {
    const { link } = setupPress();
    // Makes everything unselectable in CSS while it's set (global.css).
    const marked = () => "longPress" in document.documentElement.dataset;
    press(link);
    expect(select()).toBe(true);
    expect(marked()).toBe(false);
    vi.advanceTimersByTime(450);
    expect(select()).toBe(false);
    expect(marked()).toBe(true);
    fireEvent.pointerUp(link, { pointerId: 1 });
    expect(select()).toBe(true);
    expect(marked()).toBe(false);
  });

  it("keeps blocking selection after the phone cancels the press, until the finger lifts", () => {
    const { link } = setupPress();
    press(link);
    vi.advanceTimersByTime(450);
    fireEvent.pointerCancel(link, { pointerId: 1 });
    expect(select()).toBe(false);
    fireEvent.touchEnd(window);
    expect(select()).toBe(true);
  });

  it("stops blocking at the next press if the lift never comes", () => {
    const { link } = setupPress();
    press(link);
    vi.advanceTimersByTime(450);
    // The phone cancelled the whole touch, so there's no lift.
    fireEvent.pointerCancel(link, { pointerId: 1 });
    fireEvent.pointerDown(document.body, { button: 0, pointerId: 2 });
    expect(select()).toBe(true);
  });

  it("is just a click when let go sooner", () => {
    const { onLongPress, onLinkClick, link } = setupPress();
    press(link);
    vi.advanceTimersByTime(200);
    fireEvent.pointerUp(link, { pointerId: 1 });
    fireEvent.click(link);
    vi.advanceTimersByTime(500);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onLinkClick).toHaveBeenCalledTimes(1);
  });

  it("doesn't load anything for a tap", () => {
    const { onPressStart, link } = setupPress();
    press(link);
    vi.advanceTimersByTime(100);
    fireEvent.pointerUp(link, { pointerId: 1 });
    vi.advanceTimersByTime(500);
    expect(onPressStart).not.toHaveBeenCalled();
  });

  it.each([
    ["a swipe", -40, 0],
    ["a scroll", 0, 40],
  ])("doesn't open after %s", (_name, dx, dy) => {
    const { onLongPress, link } = setupPress();
    hold(link, dx, dy);
    vi.advanceTimersByTime(500);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("opens on a right click, and once per long press", () => {
    const { onLongPress, link } = setupPress();
    expect(fireEvent.contextMenu(link)).toBe(false);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    // Android sends a context menu after its own long press.
    press(link);
    vi.advanceTimersByTime(450);
    fireEvent.contextMenu(link);
    expect(onLongPress).toHaveBeenCalledTimes(2);
  });

  it("keeps the browser's menu on rows without a preview", () => {
    setup();
    const link = screen.getByRole("link", { name: "Add login" });
    expect(fireEvent.contextMenu(link)).toBe(true);
  });
});

describe("rowOffset", () => {
  const acts = SWIPE_MIN_PX;

  it("trails the finger by ROW_GIVE, either way", () => {
    expect(rowOffset(100, acts)).toBeCloseTo(100 * ROW_GIVE);
    expect(rowOffset(-100, acts)).toBeCloseTo(-100 * ROW_GIVE);
    expect(rowOffset(0, acts)).toBe(0);
  });

  it("gets heavier past where letting go acts, with no jump", () => {
    const armed = rowOffset(acts, acts);
    expect(armed).toBeCloseTo(acts * ROW_GIVE);
    expect(rowOffset(acts + 1, acts) - armed).toBeCloseTo(ROW_GIVE, 1);
    const next = rowOffset(acts + 100, acts) - armed;
    expect(next).toBeLessThan(100 * ROW_GIVE);
    expect(rowOffset(acts + 200, acts) - armed - next).toBeLessThan(next);
    expect(rowOffset(10_000, acts)).toBeLessThan(armed + PAST_ARMED_MAX_PX);
  });
});
