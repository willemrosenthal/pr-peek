import { expect, it } from "vitest";
import { daysLeft, plural } from "./token-expiry";

const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const inDays = (days: number) => new Date(NOW + days * 24 * 60 * 60 * 1000);

it("counts days left, part of a day counting as one", () => {
  expect(daysLeft(inDays(1.2), NOW)).toBe(2);
  expect(daysLeft(inDays(7), new Date(NOW))).toBe(7);
  expect(daysLeft(inDays(-1.5).toISOString(), NOW)).toBe(-1);
});

it("says one day, not one days", () => {
  expect(plural(1, "day")).toBe("1 day");
  expect(plural(5, "repo")).toBe("5 repos");
});
