import { afterEach, expect, it } from "vitest";
import { appScale, NORMAL_SCALE, scaleLabel, SCALES } from "./scale";

afterEach(() => localStorage.clear());

it("puts the normal size in the middle, reading 100%", () => {
  expect(SCALES[Math.floor(SCALES.length / 2)]).toBe(NORMAL_SCALE);
  expect(scaleLabel(NORMAL_SCALE)).toBe("100%");
});

it("labels each step 5% from the next", () => {
  const percents = SCALES.map((scale) => Number.parseInt(scaleLabel(scale)));
  for (const [step, percent] of percents.slice(1).entries()) {
    expect(percent - percents[step]!).toBe(5);
  }
});

it("starts at the normal size, and goes back to it from a size no longer offered", () => {
  expect(appScale.get()).toBe(NORMAL_SCALE);
  localStorage.setItem("pr-peek:scale", JSON.stringify(SCALES[0]! - 0.05));
  expect(appScale.get()).toBe(NORMAL_SCALE);
});
