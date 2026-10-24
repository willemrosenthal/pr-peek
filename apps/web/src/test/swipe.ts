import { fireEvent } from "@testing-library/react";

// jsdom has no pointer capture. Call before swiping.
export function stubPointerCapture() {
  Element.prototype.setPointerCapture = () => {};
}

// Presses on `el`, moves `dx` across and `dy` down, then lets go.
export function drag(el: Element, dx: number, dy = 0) {
  const at = (share: number) => ({
    pointerId: 1,
    clientX: 200 + dx * share,
    clientY: 20 + dy * share,
  });
  fireEvent.pointerDown(el, { button: 0, ...at(0) });
  fireEvent.pointerMove(el, at(0.5));
  fireEvent.pointerMove(el, at(1));
  fireEvent.pointerUp(el, at(1));
}
