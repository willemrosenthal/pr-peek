import { expect, it } from "vitest";
import { tagTextColor } from "./repoColor";

const channels = (hex: string) =>
  [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));

it.each([
  ["#1e3a8a", "lighter"],
  ["#7c3aed", "lighter"],
  ["#25eba9", "darker"],
  ["#fde047", "darker"],
])("gives %s a %s shade of itself for text", (background, shade) => {
  const text = tagTextColor(background);
  expect(text).toMatch(/^#[0-9a-f]{6}$/);
  // Every channel moves the same way: up for lighter, down for darker.
  const moved = channels(text).map((part, i) =>
    Math.sign(part - channels(background)[i]!),
  );
  expect(moved).toEqual(shade === "lighter" ? [1, 1, 1] : [-1, -1, -1]);
});
