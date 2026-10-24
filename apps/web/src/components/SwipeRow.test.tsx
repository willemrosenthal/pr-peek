import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { MouseEvent } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { drag, FAR_ENOUGH, hold, stubPointerCapture } from "../test/swipe";
import { SwipeRow } from "./SwipeRow";
import styles from "./SwipeRow.module.css";

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

// Waits longer than a row takes to slide out.
const settle = () => new Promise((done) => setTimeout(done, 300));

// The strip behind the row, while it shows.
const strip = () => screen.queryByText("Quiet");

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

  it.each([-40, 120])("springs back from a %ipx swipe", async (dx) => {
    const { onToggle, link } = setup();
    drag(link, dx);
    await settle();
    expect(onToggle).not.toHaveBeenCalled();
    expect(strip()).toBe(null);
  });

  it("needs a longer swipe on a wider row", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(600);
    const { onToggle, link } = setup();
    // 45% of 600 is 270.
    drag(link, -FAR_ENOUGH);
    await settle();
    expect(onToggle).not.toHaveBeenCalled();
    drag(link, -300);
    await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(1));
  });

  it("shows when the row has gone far enough to quiet it", () => {
    const { link } = setup();
    hold(link, -100);
    expect(strip()!.className).not.toContain(styles.armed);
    hold(link, -FAR_ENOUGH);
    expect(strip()!.className).toContain(styles.armed);
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

  it("lets a click elsewhere through right after a swipe", () => {
    const { link } = setup();
    const other = vi.fn();
    document.body.addEventListener("click", other);
    drag(link, -FAR_ENOUGH);
    fireEvent.click(document.body);
    document.body.removeEventListener("click", other);
    expect(other).toHaveBeenCalledTimes(1);
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
    fireEvent.wheel(link, { deltaX: 120, deltaY: 0 });
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
