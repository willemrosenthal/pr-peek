import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { holdPull, pull } from "../test/swipe";
import { PullToRefresh } from "./PullToRefresh";
import styles from "./PullToRefresh.module.css";

function setup() {
  const onRefresh = vi.fn();
  const view = render(
    <PullToRefresh refreshing={false} onRefresh={onRefresh} enabled />,
  );
  const rerender = (refreshing: boolean) =>
    view.rerender(
      <PullToRefresh refreshing={refreshing} onRefresh={onRefresh} enabled />,
    );
  const circle = view.container.querySelector(`.${styles.circle}`)!;
  return { onRefresh, rerender, circle };
}

// How far down the circle is.
const shownAt = (circle: Element) => (circle as HTMLElement).style.transform;

describe("PullToRefresh", () => {
  afterEach(() => {
    Object.assign(window, { scrollY: 0 });
  });

  it("refreshes only once pulled far enough", () => {
    const { onRefresh } = setup();
    pull(document.body, 100);
    expect(onRefresh).not.toHaveBeenCalled();
    pull(document.body, 200);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("turns blue once far enough", () => {
    const { circle } = setup();
    holdPull(document.body, 100);
    expect(circle.className).not.toContain(styles.armed);
    holdPull(document.body, 200);
    expect(circle.className).toContain(styles.armed);
  });

  it("ignores a sideways swipe, and a pull once scrolled down", () => {
    const { onRefresh } = setup();
    pull(document.body, 200, 250);
    Object.assign(window, { scrollY: 50 });
    pull(document.body, 200);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("stays and spins until the refresh ends", () => {
    const { rerender, circle } = setup();
    pull(document.body, 200);
    rerender(true);
    expect(shownAt(circle)).toBe("translateY(48px)");
    expect(circle.querySelector(`.${styles.spin}`)).toBeTruthy();

    rerender(false);
    expect(shownAt(circle)).toBe("translateY(0px)");
    expect(circle.querySelector(`.${styles.spin}`)).toBe(null);
  });

  it("stays hidden when the Refresh button refreshes", () => {
    const { rerender, circle } = setup();
    rerender(true);
    expect(shownAt(circle)).toBe("translateY(0px)");
  });

  it("goes back up without refreshing when a second finger lands", () => {
    const { onRefresh, circle } = setup();
    holdPull(document.body, 200);
    fireEvent.touchStart(document.body, {
      touches: [
        { clientX: 200, clientY: 300 },
        { clientX: 100, clientY: 300 },
      ],
    });
    fireEvent.touchEnd(document.body, { touches: [] });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(shownAt(circle)).toBe("translateY(0px)");
  });
});
