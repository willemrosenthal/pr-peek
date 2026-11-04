import { act, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { expect, it } from "vitest";
import {
  offerInstall,
  stubDisplayMode,
  stubUserAgent,
  USER_AGENTS,
} from "../test/install";
import { renderApp } from "../test/render";
import { stubTauri } from "../test/tauri";

const installButton = () =>
  screen.queryByRole("button", { name: "Install Git Buddy" });

const INSTALLED = "Git Buddy is installed on this device.";

it("installs with the offer Chrome sent before the page opened", async () => {
  stubUserAgent(USER_AGENTS.chrome);
  const offer = offerInstall();
  renderApp("/install");

  await userEvent.click(installButton()!);
  expect(offer.prompt).toHaveBeenCalledOnce();
  expect(await screen.findByText(INSTALLED)).toBeTruthy();
});

it("shows the menu steps after the install dialog is closed", async () => {
  stubUserAgent(USER_AGENTS.chrome);
  offerInstall("dismissed");
  renderApp("/install");

  await userEvent.click(installButton()!);
  expect(await screen.findByText("Open the browser menu.")).toBeTruthy();
  expect(installButton()).toBe(null);
});

it("shows the menu steps when the browser won't open its dialog", async () => {
  stubUserAgent(USER_AGENTS.chrome);
  const offer = offerInstall();
  offer.prompt.mockRejectedValue(new Error("already shown"));
  renderApp("/install");

  await userEvent.click(installButton()!);
  expect(await screen.findByText("Open the browser menu.")).toBeTruthy();
});

it("shows the button when the offer comes after the page opened", () => {
  stubUserAgent(USER_AGENTS.chrome);
  renderApp("/install");
  expect(installButton()).toBe(null);
  offerInstall();
  expect(installButton()).toBeTruthy();
});

it("says so when the app gets installed from the browser's own menu", () => {
  stubUserAgent(USER_AGENTS.chrome);
  renderApp("/install");
  act(() => {
    window.dispatchEvent(new Event("appinstalled"));
  });
  expect(screen.getByText(INSTALLED)).toBeTruthy();
});

it("shows iPhone steps on an iPhone, and the rest under other devices", () => {
  stubUserAgent(USER_AGENTS.iphone);
  renderApp("/install");

  expect(screen.getByText("Tap Add to Home Screen, then Add.")).toBeTruthy();
  expect(
    screen.getByText(
      "On iPhone, notifications only work in the Home Screen app.",
    ),
  ).toBeTruthy();
  const others = screen
    .getAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent);
  expect(others).toEqual(["Android, Chrome, and Edge", "Safari on a Mac"]);
});

it("shows Add to Dock in Safari on a Mac", () => {
  stubUserAgent(USER_AGENTS.macSafari);
  renderApp("/install");
  expect(screen.getByText("Choose File, then Add to Dock.")).toBeTruthy();
});

it("points to another browser when this one can't install", () => {
  stubUserAgent(USER_AGENTS.firefox);
  renderApp("/install");
  expect(screen.getByText(/This browser can't install apps/)).toBeTruthy();
  expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
});

it("says so when opened as the installed app", () => {
  stubDisplayMode({ standalone: true });
  renderApp("/install");
  expect(screen.getByText(INSTALLED)).toBeTruthy();
});

it("links to the Mac app's latest release", () => {
  renderApp("/install");
  const download = screen.getByRole("link", { name: "Download for Mac" });
  expect(download.getAttribute("href")).toMatch(/\/releases\/latest$/);
});

it("doesn't offer the Mac app inside the Mac app", () => {
  stubTauri();
  renderApp("/install");
  expect(screen.queryByRole("link", { name: "Download for Mac" })).toBe(null);
});
