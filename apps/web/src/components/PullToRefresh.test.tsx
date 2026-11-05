import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { holdPull, pull, PULL_FAR_ENOUGH } from "../test/swipe";
import { PullToRefresh, pullOffset } from "./PullToRefresh";
import styles from "./PullToRefresh.module.css";

function setup() {
  const onRefresh = vi.fn();
  const page = (refreshing: boolean) => (
    <PullToRefresh refreshing={refreshing} onRefresh={onRefresh} enabled>
      <p>The list</p>
    </PullToRefresh>
  );
  const view = render(page(false));
  const rerender = (refreshing: boolean) => view.rerender(page(refreshing));
  const pageEl = view.getByText("The list").parentElement!;
  const spinner = view.container.querySelector<HTMLElement>(
    `.${styles.spinner}`,
  )!;
  const rainbow = view.container.querySelector(`.${styles.rainbow}`)!;
  const rainbowShown = () => rainbow.classList.contains(styles.shown!);
  return { onRefresh, rerender, page: pageEl, spinner, rainbowShown, view };
}

// How far down the page is, in pixels. 0 at rest.
const pageAt = (page: HTMLElement) =>
  Number(/translateY\(([\d.]+)px\)/.exec(page.style.transform)?.[1] ?? 0);

describe("pullOffset", () => {
  it("gets heavier the further it goes, and stops at a limit", () => {
    const first = pullOffset(100);
    const second = pullOffset(200) - first;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(100);
    expect(second).toBeLessThan(first);
    expect(pullOffset(10_000)).toBeLessThan(160);
    expect(pullOffset(-50)).toBe(0);
  });

  it("moves less than the finger, even at the start", () => {
    expect(pullOffset(10)).toBeLessThan(6);
  });
});

describe("usePullToRefresh", () => {
  afterEach(() => {
    Object.assign(window, { scrollY: 0 });
  });

  it("brings the page down with the finger, over the spinner", () => {
    const { page, spinner } = setup();
    expect(pageAt(page)).toBe(0);
    expect(spinner.style.opacity).toBe("0");

    holdPull(document.body, 100);
    const partWay = pageAt(page);
    expect(partWay).toBeGreaterThan(0);
    expect(Number(spinner.style.opacity)).toBeLessThan(1);

    holdPull(document.body, PULL_FAR_ENOUGH);
    expect(pageAt(page)).toBeGreaterThan(partWay);
    expect(spinner.style.opacity).toBe("1");
  });

  it("turns the gap rainbow once letting go would refresh", () => {
    const { rainbowShown } = setup();
    holdPull(document.body, 100);
    expect(rainbowShown()).toBe(false);
    holdPull(document.body, PULL_FAR_ENOUGH);
    expect(rainbowShown()).toBe(true);
    fireEvent.touchEnd(document.body, { touches: [] });
    expect(rainbowShown()).toBe(false);
  });

  it("mixes new splotches each time a pull gets far enough", () => {
    const { view } = setup();
    const splotches = () =>
      view.container.querySelector(`.${styles.splotches}`);
    holdPull(document.body, PULL_FAR_ENOUGH);
    const first = splotches();
    fireEvent.touchEnd(document.body, { touches: [] });
    holdPull(document.body, PULL_FAR_ENOUGH);
    expect(splotches()).not.toBe(first);
  });

  it("refreshes only once pulled far enough", () => {
    const { onRefresh } = setup();
    pull(document.body, 100);
    expect(onRefresh).not.toHaveBeenCalled();
    pull(document.body, PULL_FAR_ENOUGH);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("hides the ring as the page goes up after refreshing, until the next pull", () => {
    const { spinner } = setup();
    const hidden = () => spinner.classList.contains(styles.fired!);
    pull(document.body, 100);
    expect(hidden()).toBe(false);
    pull(document.body, PULL_FAR_ENOUGH);
    expect(hidden()).toBe(true);
    holdPull(document.body, 100);
    expect(hidden()).toBe(false);
  });

  it("springs back up when the finger lifts, while the refresh runs", () => {
    const { page, rerender } = setup();
    pull(document.body, PULL_FAR_ENOUGH);
    rerender(true);
    expect(pageAt(page)).toBe(0);
    expect(page.style.transform).toBe("");
  });

  it("ignores a sideways swipe, and a pull once scrolled down", () => {
    const { onRefresh, page } = setup();
    holdPull(document.body, 200, 250);
    expect(pageAt(page)).toBe(0);
    fireEvent.touchEnd(document.body, { touches: [] });
    Object.assign(window, { scrollY: 50 });
    pull(document.body, PULL_FAR_ENOUGH);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("shows a running refresh when pulled, without starting another", () => {
    const { onRefresh, rerender, page, spinner, rainbowShown, view } = setup();
    rerender(true);
    expect(rainbowShown()).toBe(false);
    // Any pull shows the colors and says so, with no ring.
    holdPull(document.body, 20);
    expect(pageAt(page)).toBeGreaterThan(0);
    expect(spinner.style.opacity).toBe("1");
    expect(rainbowShown()).toBe(true);
    expect(view.queryByText("Refreshing…")).toBeTruthy();
    expect(spinner.querySelector(`.${styles.ring}`)).toBe(null);
    fireEvent.touchEnd(document.body, { touches: [] });
    holdPull(document.body, PULL_FAR_ENOUGH);
    fireEvent.touchEnd(document.body, { touches: [] });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(pageAt(page)).toBe(0);
  });

  it("doesn't redraw the list inside while a finger pulls", () => {
    let renders = 0;
    function List() {
      renders++;
      return <p>Rows</p>;
    }
    render(
      <PullToRefresh refreshing={false} onRefresh={vi.fn()} enabled>
        <List />
      </PullToRefresh>,
    );
    expect(renders).toBe(1);
    pull(document.body, PULL_FAR_ENOUGH);
    expect(renders).toBe(1);
  });

  it("goes back up without refreshing when a second finger lands", () => {
    const { onRefresh, page } = setup();
    holdPull(document.body, PULL_FAR_ENOUGH);
    fireEvent.touchStart(document.body, {
      touches: [
        { clientX: 200, clientY: 300 },
        { clientX: 100, clientY: 300 },
      ],
    });
    fireEvent.touchEnd(document.body, { touches: [] });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(pageAt(page)).toBe(0);
  });
});
