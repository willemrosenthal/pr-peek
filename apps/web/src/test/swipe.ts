import { fireEvent } from "@testing-library/react";

// jsdom has no pointer capture. Call before swiping.
export function stubPointerCapture() {
  Element.prototype.setPointerCapture = () => {};
}

// Far enough to quiet a row in jsdom, where rows have no width.
export const FAR_ENOUGH = 200;

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

// A finger on `el` moves `dy` down and `dx` across, then lifts. For pull to refresh.
export function pull(el: Element, dy: number, dx = 0) {
  const finger = (share: number) => ({
    touches: [{ clientX: 200 + dx * share, clientY: 100 + dy * share }],
  });
  fireEvent.touchStart(el, finger(0));
  fireEvent.touchMove(el, finger(0.5));
  fireEvent.touchMove(el, finger(1));
  fireEvent.touchEnd(el, { touches: [] });
}

// Presses on `el`, moves `dx` across and `dy` down, then lets go.
export function drag(el: Element, dx: number, dy = 0) {
  hold(el, dx, dy);
  fireEvent.pointerUp(el, at(dx, dy, 1));
}
