import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { appTheme, applyTheme } from "./theme";

const tokens = readFileSync(`${import.meta.dirname}/styles/tokens.css`, "utf8");

afterEach(() => {
  localStorage.clear();
  applyTheme("system");
  document.head.innerHTML = "";
});

// The custom properties set in a CSS block, without indents.
function colorsIn(selector: string) {
  const start = tokens.indexOf(`${selector} {`);
  const end = tokens.indexOf("}", start);
  return tokens
    .slice(start, end)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("--"));
}

it("uses the same dark colors for the device's dark mode and a picked one", () => {
  const device = colorsIn(':root:not([data-theme="light"])');
  expect(device.length).toBeGreaterThan(0);
  expect(colorsIn(':root[data-theme="dark"]')).toEqual(device);
});

it("follows the device until a mode is picked, and ignores an unknown one", () => {
  expect(appTheme.get()).toBe("system");
  localStorage.setItem("pr-peek:theme", JSON.stringify("sepia"));
  expect(appTheme.get()).toBe("system");
});

it("marks the page with a picked mode, and colors the browser's bar to match", () => {
  document.head.innerHTML = `
    <meta name="theme-color" content="#f2f2f5" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#111113" media="(prefers-color-scheme: dark)" />`;
  const bars = () =>
    [...document.querySelectorAll<HTMLMetaElement>("meta")].map(
      (meta) => meta.content,
    );
  const root = document.documentElement;

  applyTheme("dark");
  expect(root.dataset.theme).toBe("dark");
  expect(bars()).toEqual(["#111113", "#111113"]);

  applyTheme("light");
  expect(root.dataset.theme).toBe("light");
  expect(bars()).toEqual(["#f2f2f5", "#f2f2f5"]);

  applyTheme("system");
  expect(root.dataset.theme).toBeUndefined();
  expect(bars()).toEqual(["#f2f2f5", "#111113"]);
});
