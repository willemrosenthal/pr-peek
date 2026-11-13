import { localSetting } from "./localSetting";

// Light or dark mode, or whichever the device uses.
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

// Kept on this device, since each one can have its own mode.
export const appTheme = localSetting<Theme>(
  "pr-peek:theme",
  "system",
  (value): value is Theme => THEMES.includes(value as Theme),
);

// --color-page in tokens.css, for the browser's bar around the app.
const PAGE_COLOR = { light: "#f2f2f5", dark: "#111113" };

// tokens.css picks colors by data-theme on <html>. With none, it follows the device.
export function applyTheme(theme = appTheme.get()) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;

  // index.html has one bar color for each device mode. A picked mode sets both.
  for (const meta of document.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  )) {
    const deviceMode = meta.getAttribute("media")?.includes("dark")
      ? "dark"
      : "light";
    meta.content = PAGE_COLOR[theme === "system" ? deviceMode : theme];
  }
}

export function setTheme(theme: Theme) {
  appTheme.set(theme);
  applyTheme(theme);
}
