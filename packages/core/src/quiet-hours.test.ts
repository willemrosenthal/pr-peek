import { describe, expect, it } from "vitest";
import { isQuiet, type QuietSettings } from "./quiet-hours";

const settings = (overrides: Partial<QuietSettings> = {}): QuietSettings => ({
  timezone: "UTC",
  quietStart: "22:00",
  quietEnd: "07:00",
  quietWeekends: false,
  ...overrides,
});

// 2026-10-23 is a Friday.
const friday = (time: string) => new Date(`2026-10-23T${time}:00Z`);

describe("isQuiet", () => {
  it.each([
    ["21:59", false],
    ["22:00", true],
    ["23:30", true],
    ["06:59", true],
    ["07:00", false],
    ["12:00", false],
  ])("quiet hours across midnight, at %s: %s", (time, quiet) => {
    expect(isQuiet(settings(), friday(time))).toBe(quiet);
  });

  it.each([
    ["11:59", false],
    ["12:00", true],
    ["12:59", true],
    ["13:00", false],
  ])("quiet hours within a day, at %s: %s", (time, quiet) => {
    const midday = settings({ quietStart: "12:00", quietEnd: "13:00" });
    expect(isQuiet(midday, friday(time))).toBe(quiet);
  });

  it("is never quiet with quiet hours off, or the same start and end", () => {
    const off = settings({ quietStart: null, quietEnd: null });
    const empty = settings({ quietStart: "22:00", quietEnd: "22:00" });
    expect(isQuiet(off, friday("23:00"))).toBe(false);
    expect(isQuiet(empty, friday("22:00"))).toBe(false);
  });

  it("uses the user's timezone", () => {
    const newYork = settings({ timezone: "America/New_York" });
    // 23:00 and 08:00 in New York.
    expect(isQuiet(newYork, friday("03:00"))).toBe(true);
    expect(isQuiet(newYork, friday("12:00"))).toBe(false);
  });

  it("is quiet all weekend in the user's timezone", () => {
    const weekends = { quietStart: null, quietEnd: null, quietWeekends: true };
    // Still Friday in UTC, but already Saturday 01:00 in Auckland.
    const now = friday("12:00");
    expect(isQuiet(settings(weekends), now)).toBe(false);
    expect(
      isQuiet(settings({ ...weekends, timezone: "Pacific/Auckland" }), now),
    ).toBe(true);
    expect(isQuiet(settings(), new Date("2026-10-24T12:00:00Z"))).toBe(false);
  });
});
