import { describe, expect, it } from "vitest";
import { rubberBand } from "./rubber-band";

describe("rubberBand", () => {
  it("moves about as far at first", () => {
    expect(rubberBand(1, 100)).toBeCloseTo(1, 1);
  });

  it("gives less the further it goes, and never reaches max", () => {
    const first = rubberBand(50, 100);
    expect(rubberBand(100, 100) - first).toBeLessThan(first);
    expect(rubberBand(10_000, 100)).toBeLessThan(100);
  });

  it("doesn't move backward", () => {
    expect(rubberBand(-50, 100)).toBe(0);
  });
});
