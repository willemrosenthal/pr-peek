import { fireEvent } from "@testing-library/react";
import { SWIPE_MIN_PX } from "../components/SwipeRow";

// jsdom has no pointer capture. Call before swiping.
export function stubPointerCapture() {
  Element.prototype.setPointerCapture = () => {};
}

// Far enough to quiet a row in jsdom, where rows have no width, and short of it.
export const FAR_ENOUGH = SWIPE_MIN_PX + 60;
export const NOT_FAR_ENOUGH = SWIPE_MIN_PX - 40;

const at = (dx: number, dy: number, share: number) => ({
  pointerId: 1,
  clientX: 200 + dx * share,
  clientY: 20 + dy * share,
});

// Presses on `el` and moves `dx` across and `dy` down, without letting go.
export function hold(el: Element, dx: number, dy = 0) {
  fireEvent.pointerDown(el, { button: 0, ...at(dx, dy, 0) });
  fireEvent.pointerMove(el, at(dx, dy, 0.5));
  fireEvent.pointerMove(el, at(dx, dy, 1));
}

// Far enough to refresh with pull to refresh.
export const PULL_FAR_ENOUGH = 300;

// For pull to refresh: a finger on `el` moves `dy` down and `dx` across, and stays.
export function holdPull(el: Element, dy: number, dx = 0) {
  const finger = (share: number) => ({
    touches: [{ clientX: 200 + dx * share, clientY: 100 + dy * share }],
  });
  fireEvent.touchStart(el, finger(0));
  fireEvent.touchMove(el, finger(0.5));
  fireEvent.touchMove(el, finger(1));
}

// The same, then the finger lifts.
export function pull(el: Element, dy: number, dx = 0) {
  holdPull(el, dy, dx);
  fireEvent.touchEnd(el, { touches: [] });
}

// Presses on `el`, moves `dx` across and `dy` down, then lets go.
export function drag(el: Element, dx: number, dy = 0) {
  hold(el, dx, dy);
  fireEvent.pointerUp(el, at(dx, dy, 1));
}
