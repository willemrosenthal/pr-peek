import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useIosPush } from "./useIosPush";

const iosPush = vi.hoisted(() => ({
  stop: vi.fn(),
  startIosPush: vi.fn(),
}));
vi.mock("../iosPush", () => iosPush);

// The hook inside a data router, like the app's.
function inRouter({ children }: { children: ReactNode }) {
  const router = createMemoryRouter([{ path: "/", element: children }]);
  return <RouterProvider router={router} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  iosPush.startIosPush.mockResolvedValue(iosPush.stop);
});

afterEach(() => {
  history.replaceState(null, "", "/");
  sessionStorage.clear();
});

it("does nothing outside the iPhone app", () => {
  renderHook(useIosPush, { wrapper: inRouter });
  expect(iosPush.startIosPush).not.toHaveBeenCalled();
});

it("starts in the iPhone app, and stops when it leaves", async () => {
  history.replaceState(null, "", "/?shell=ios");
  const { unmount } = renderHook(useIosPush, { wrapper: inRouter });
  await vi.waitFor(() => expect(iosPush.startIosPush).toHaveBeenCalledOnce());
  // The hook saw it start (its handler came first), then it leaves.
  await iosPush.startIosPush.mock.results[0]?.value;
  unmount();
  expect(iosPush.stop).toHaveBeenCalledOnce();
});

it("stops once it starts, when it left before then", async () => {
  history.replaceState(null, "", "/?shell=ios");
  let started!: (stop: () => void) => void;
  iosPush.startIosPush.mockReturnValue(
    new Promise((resolve) => (started = resolve)),
  );
  const { unmount } = renderHook(useIosPush, { wrapper: inRouter });
  unmount();
  started(iosPush.stop);
  await vi.waitFor(() => expect(iosPush.stop).toHaveBeenCalledOnce());
});
