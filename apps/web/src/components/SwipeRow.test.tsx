import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { MouseEvent } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SwipeRow } from "./SwipeRow";

// jsdom has no pointer capture.
beforeAll(() => {
  if (!("setPointerCapture" in Element.prototype)) {
    Element.prototype.setPointerCapture = () => {};
  }
});

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

// Presses on `el`, moves `dx` across and `dy` down, then lets go.
function drag(el: Element, dx: number, dy = 0) {
  fireEvent.pointerDown(el, {
    button: 0,
    pointerId: 1,
    clientX: 200,
    clientY: 20,
  });
  fireEvent.pointerMove(el, {
    pointerId: 1,
    clientX: 200 + dx / 2,
    clientY: 20 + dy / 2,
  });
  fireEvent.pointerMove(el, {
    pointerId: 1,
    clientX: 200 + dx,
    clientY: 20 + dy,
  });
  fireEvent.pointerUp(el, {
    pointerId: 1,
    clientX: 200 + dx,
    clientY: 20 + dy,
  });
}

describe("SwipeRow", () => {
  it("quiets the PR when swiped far enough either way", async () => {
    const { onToggle, link } = setup();
    drag(link, -120);
    await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(1));
    drag(link, 120);
    await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(2));
  });

  it("doesn't open the link when a swipe ends", () => {
    const { onLinkClick, link } = setup();
    drag(link, -120);
    fireEvent.click(link);
    expect(onLinkClick).not.toHaveBeenCalled();
    // The next click opens it.
    fireEvent.click(link);
    return waitFor(() => expect(onLinkClick).toHaveBeenCalled());
  });

  it("springs back from a short swipe", async () => {
    const { onToggle, link } = setup();
    drag(link, -40);
    await new Promise((done) => setTimeout(done, 300));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("lets the list scroll when the move is mostly down", async () => {
    const { onToggle, link } = setup();
    drag(link, -100, 200);
    await new Promise((done) => setTimeout(done, 300));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("quiets on a two-finger trackpad swipe", async () => {
    const { onToggle, link } = setup();
    fireEvent.wheel(link, { deltaX: 60, deltaY: 2 });
    fireEvent.wheel(link, { deltaX: 60, deltaY: 0 });
    await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(1));
  });

  it("ignores vertical scrolling", async () => {
    const { onToggle, link } = setup();
    fireEvent.wheel(link, { deltaX: 10, deltaY: 200 });
    await new Promise((done) => setTimeout(done, 300));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("has a button for mouse and keyboard users", async () => {
    const { onToggle } = setup();
    await userEvent.click(
      screen.getByRole("button", { name: "Quiet until something new happens" }),
    );
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("offers to bring a quiet PR back", () => {
    setup(true);
    expect(screen.getByRole("button", { name: "Bring back" })).toBeTruthy();
  });
});
