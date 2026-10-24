import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { MouseEvent } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { drag, stubPointerCapture } from "../test/swipe";
import { SwipeRow } from "./SwipeRow";

beforeAll(stubPointerCapture);

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

describe("SwipeRow", () => {
  it.each([-120, 120])("quiets the PR when swiped %ipx, once", async (dx) => {
    const { onToggle, link } = setup();
    drag(link, dx);
    await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(1));
    // Slid out, so another swipe does nothing.
    drag(link, dx);
    await new Promise((done) => setTimeout(done, 300));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("doesn't open the link when a swipe ends", () => {
    const { onLinkClick, link } = setup();
    drag(link, -120);
    fireEvent.click(link);
    expect(onLinkClick).not.toHaveBeenCalled();
    // Only that click is blocked.
    fireEvent.click(link);
    expect(onLinkClick).toHaveBeenCalledTimes(1);
  });

  it("lets a click elsewhere through right after a swipe", () => {
    const { link } = setup();
    const other = vi.fn();
    document.body.addEventListener("click", other);
    drag(link, -120);
    fireEvent.click(document.body);
    document.body.removeEventListener("click", other);
    expect(other).toHaveBeenCalledTimes(1);
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
