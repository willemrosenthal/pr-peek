import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { useRegisterSW } from "virtual:pwa-register/react";
import { hideWindow } from "../test/visibility";
import { UpdatePrompt } from "./UpdatePrompt";

vi.mock("virtual:pwa-register/react", () => ({ useRegisterSW: vi.fn() }));

const updateServiceWorker = vi.fn(() => Promise.resolve());

function registerSW(needRefresh: boolean) {
  vi.mocked(useRegisterSW).mockReturnValue({
    needRefresh: [needRefresh, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker,
  });
}

afterEach(() => {
  vi.useRealTimers();
  updateServiceWorker.mockClear();
});

it("shows nothing when the app is up to date", () => {
  registerSW(false);
  render(<UpdatePrompt />);
  expect(screen.queryByRole("status")).toBe(null);
});

it("reloads into the new version", async () => {
  registerSW(true);
  render(<UpdatePrompt />);
  expect(screen.getByRole("status").textContent).toMatch(
    /New version available/,
  );
  await userEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(updateServiceWorker).toHaveBeenCalledWith(true);
});

it("updates when the menu bar window hides, only once one is waiting", () => {
  registerSW(false);
  const { rerender } = render(<UpdatePrompt />);
  hideWindow();
  expect(updateServiceWorker).not.toHaveBeenCalled();

  registerSW(true);
  rerender(<UpdatePrompt />);
  hideWindow();
  expect(updateServiceWorker).toHaveBeenCalledWith(true);
});

it("looks for a new version every hour", () => {
  vi.useFakeTimers();
  registerSW(false);
  render(<UpdatePrompt />);
  const registration = { update: vi.fn(() => Promise.resolve()) };
  const options = vi.mocked(useRegisterSW).mock.lastCall?.[0];
  options?.onRegisteredSW?.(
    "/sw.js",
    registration as unknown as ServiceWorkerRegistration,
  );
  vi.advanceTimersByTime(59 * 60 * 1000);
  expect(registration.update).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60 * 1000);
  expect(registration.update).toHaveBeenCalledTimes(1);
});
