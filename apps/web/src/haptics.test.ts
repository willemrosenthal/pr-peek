import { afterEach, describe, expect, it, vi } from "vitest";
import { haptic } from "./haptics";

describe("haptic", () => {
  // jsdom has no vibrate, like iPhones.
  afterEach(() => {
    Reflect.deleteProperty(navigator, "vibrate");
  });

  it("vibrates where the phone can", () => {
    const vibrate = vi.fn(() => true);
    Object.assign(navigator, { vibrate });
    haptic();
    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it("flips a hidden switch otherwise, and cleans it up", () => {
    const flipped: boolean[] = [];
    const onChange = (event: Event) =>
      flipped.push((event.target as Element).hasAttribute("switch"));
    document.addEventListener("change", onChange);
    haptic();
    document.removeEventListener("change", onChange);
    expect(flipped).toEqual([true]);
    expect(document.querySelector("input[switch]")).toBe(null);
  });
});
