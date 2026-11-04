import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { holdPull, pull } from "../test/swipe";
import {
  PullToRefreshSpinner,
  pullOffset,
  usePullToRefresh,
} from "./PullToRefresh";
import styles from "./PullToRefresh.module.css";

function Page({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const pulled = usePullToRefresh({ refreshing, onRefresh, enabled: true });
  return (
    <>
      <PullToRefreshSpinner
        offset={pulled.offset}
        dragging={pulled.dragging}
        refreshing={refreshing}
      />
      <div data-testid="page" {...pulled.page} />
    </>
  );
}

function setup() {
  const onRefresh = vi.fn();
  const view = render(<Page refreshing={false} onRefresh={onRefresh} />);
  const rerender = (refreshing: boolean) =>
    view.rerender(<Page refreshing={refreshing} onRefresh={onRefresh} />);
  const page = view.getByTestId("page");
  const spinner = view.container.querySelector<HTMLElement>(
    `.${styles.spinner}`,
  )!;
  const rainbow = view.container.querySelector(`.${styles.rainbow}`)!;
  const rainbowShown = () => rainbow.classList.contains(styles.shown!);
  return { onRefresh, rerender, page, spinner, rainbowShown, view };
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

    holdPull(document.body, 200);
    expect(pageAt(page)).toBeGreaterThan(partWay);
    expect(spinner.style.opacity).toBe("1");
  });

  it("turns the gap rainbow once letting go would refresh", () => {
    const { rainbowShown } = setup();
    holdPull(document.body, 100);
    expect(rainbowShown()).toBe(false);
    holdPull(document.body, 200);
    expect(rainbowShown()).toBe(true);
    fireEvent.touchEnd(document.body, { touches: [] });
    expect(rainbowShown()).toBe(false);
  });

  it("refreshes only once pulled far enough", () => {
    const { onRefresh } = setup();
    pull(document.body, 100);
    expect(onRefresh).not.toHaveBeenCalled();
    pull(document.body, 200);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("springs back up when the finger lifts, while the refresh runs", () => {
    const { page, rerender } = setup();
    pull(document.body, 200);
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
    pull(document.body, 200);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("shows a running refresh when pulled, without starting another", () => {
    const { onRefresh, rerender, page, spinner, rainbowShown, view } = setup();
    rerender(true);
    expect(view.queryByText("Refreshing…")).toBeTruthy();
    holdPull(document.body, 100);
    expect(pageAt(page)).toBeGreaterThan(0);
    expect(spinner.style.opacity).toBe("1");
    holdPull(document.body, 200);
    expect(rainbowShown()).toBe(false);
    fireEvent.touchEnd(document.body, { touches: [] });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(pageAt(page)).toBe(0);
  });

  it("goes back up without refreshing when a second finger lands", () => {
    const { onRefresh, page } = setup();
    holdPull(document.body, 200);
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
