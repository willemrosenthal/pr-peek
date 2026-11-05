import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_TOAST_MS, Toast, TOAST_MS, type ToastMessage } from "./Toast";
import styles from "./Toast.module.css";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(toast: ToastMessage) {
  const onDone = vi.fn();
  const view = render(<Toast toast={toast} onDone={onDone} />);
  return { onDone, view };
}

// Whether the toast that says `text` is sliding away.
const leaving = (text: string) =>
  screen.getByText(text).parentElement!.classList.contains(styles.leaving!);

const wait = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe("Toast", () => {
  it("slides away at the end of its time, then is done", () => {
    const { onDone } = setup({ text: "Wait a moment" });
    expect(leaving("Wait a moment")).toBe(false);
    wait(TOAST_MS - 100);
    expect(leaving("Wait a moment")).toBe(true);
    expect(onDone).not.toHaveBeenCalled();
    wait(100);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("stays longer with a button to tap", () => {
    const { onDone } = setup({
      text: "Added acme/web#7",
      action: { label: "Undo", onClick: vi.fn() },
    });
    wait(TOAST_MS);
    expect(onDone).not.toHaveBeenCalled();
    wait(ACTION_TOAST_MS - TOAST_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("starts a new toast over, not leaving", () => {
    const { onDone, view } = setup({ text: "First" });
    wait(TOAST_MS - 100);
    const second = { text: "Second" };
    view.rerender(<Toast toast={second} onDone={onDone} />);
    expect(leaving("Second")).toBe(false);
    wait(100);
    expect(onDone).not.toHaveBeenCalled();
  });
});
