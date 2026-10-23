import { expect, it } from "vitest";
import { tagTextColor } from "./repoColor";

it.each([
  ["#1e3a8a", "light"],
  ["#7c3aed", "light"],
  ["#25eba9", "dark"],
  ["#fde047", "dark"],
])("picks %s's %s shade for its text", (background, shade) => {
  const text = tagTextColor(background);
  const brightness = parseInt(text.slice(1, 3), 16);
  expect(text).toMatch(/^#[0-9a-f]{6}$/);
  expect(brightness > parseInt(background.slice(1, 3), 16)).toBe(
    shade === "light",
  );
});
