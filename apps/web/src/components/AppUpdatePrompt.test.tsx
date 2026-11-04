import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { callsOf, stubTauri } from "../test/tauri";
import { AppUpdatePrompt } from "./AppUpdatePrompt";

it("shows nothing while the Mac app is up to date", async () => {
  const invoke = stubTauri({ update_ready: false });
  render(<AppUpdatePrompt />);
  await act(() => Promise.resolve());
  expect(callsOf(invoke, "update_ready")).toHaveLength(1);
  expect(screen.queryByRole("status")).toBe(null);
});

it("offers a restart for an update that installed before the page loaded", async () => {
  const invoke = stubTauri({ update_ready: true });
  render(<AppUpdatePrompt />);
  expect((await screen.findByRole("status")).textContent).toMatch(
    /Update ready/,
  );
  await userEvent.click(screen.getByRole("button", { name: "Restart" }));
  expect(callsOf(invoke, "restart_to_update")).toHaveLength(1);
});

it("offers a restart when the app says an update is ready", async () => {
  stubTauri({ update_ready: false });
  render(<AppUpdatePrompt />);
  act(() => {
    window.dispatchEvent(new Event("pr-peek:update-ready"));
  });
  expect(await screen.findByRole("status")).toBeTruthy();
});
