import { beforeEach, expect, it, vi } from "vitest";
import { nativeHaptic } from "./native";

const haptics = vi.hoisted(() => ({
  Haptics: {
    impact: vi.fn(() => Promise.resolve()),
    notification: vi.fn(() => Promise.resolve()),
    selectionStart: vi.fn(() => Promise.resolve()),
    selectionChanged: vi.fn(() => Promise.resolve()),
    selectionEnd: vi.fn(() => Promise.resolve()),
  },
  ImpactStyle: { Medium: "MEDIUM", Light: "LIGHT" },
  NotificationType: { Success: "SUCCESS" },
}));
vi.mock("@capacitor/haptics", () => haptics);

beforeEach(() => vi.clearAllMocks());

it.each([
  ["firm", "MEDIUM"],
  ["light", "LIGHT"],
] as const)("ticks %s as a %s impact", async (kind, style) => {
  await nativeHaptic(kind);
  expect(haptics.Haptics.impact).toHaveBeenCalledWith({ style });
});

it("ticks a selection once, with its start and end around it", async () => {
  await nativeHaptic("selection");
  const { selectionStart, selectionChanged, selectionEnd } = haptics.Haptics;
  expect(selectionChanged).toHaveBeenCalledTimes(1);
  expect(selectionStart.mock.invocationCallOrder[0]).toBeLessThan(
    selectionChanged.mock.invocationCallOrder[0]!,
  );
  expect(selectionEnd.mock.invocationCallOrder[0]).toBeGreaterThan(
    selectionChanged.mock.invocationCallOrder[0]!,
  );
});

it("ticks success as a success notification", async () => {
  await nativeHaptic("success");
  expect(haptics.Haptics.notification).toHaveBeenCalledWith({
    type: "SUCCESS",
  });
});
