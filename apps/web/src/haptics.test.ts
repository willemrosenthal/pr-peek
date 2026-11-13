import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canTickAnytime, haptic } from "./haptics";
import * as native from "./test/native";

vi.mock("./native", () => import("./test/native"));

const stubVibrate = () => {
  const vibrate = vi.fn(() => true);
  Object.assign(navigator, { vibrate });
  return vibrate;
};

beforeEach(() => native.resetNative());

// jsdom has no vibrate, like iPhones.
afterEach(() => {
  Reflect.deleteProperty(navigator, "vibrate");
});

describe("haptic", () => {
  it("uses the phone's own haptics in the iPhone app, at each strength", async () => {
    native.enterIosApp();
    const vibrate = stubVibrate();
    haptic("firm");
    haptic("selection");
    await vi.waitFor(() =>
      expect(native.nativeHaptic.mock.calls).toEqual([["firm"], ["selection"]]),
    );
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("vibrates where the phone can", () => {
    const vibrate = stubVibrate();
    haptic("light");
    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it("flips a hidden switch otherwise, and cleans it up", () => {
    const flipped: boolean[] = [];
    const onChange = (event: Event) =>
      flipped.push((event.target as Element).hasAttribute("switch"));
    document.addEventListener("change", onChange);
    haptic("light");
    document.removeEventListener("change", onChange);
    expect(flipped).toEqual([true]);
    expect(document.querySelector("input[switch]")).toBe(null);
  });
});

describe("canTickAnytime", () => {
  it("is true in the iPhone app", () => {
    native.enterIosApp();
    expect(canTickAnytime()).toBe(true);
  });

  it("is true where the phone can vibrate", () => {
    stubVibrate();
    expect(canTickAnytime()).toBe(true);
  });

  it("is false in an iPhone's browser", () => {
    expect(canTickAnytime()).toBe(false);
  });
});
