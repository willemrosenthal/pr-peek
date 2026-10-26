import { describe, expect, it } from "vitest";
import {
  byUrgency,
  formatAge,
  isAtLeast,
  reminderStage,
  staleLevel,
  urgencyScore,
  waitingFor,
  type UrgencyInput,
  type WaitSettings,
} from "./urgency";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

const settings = (overrides: Partial<WaitSettings> = {}): WaitSettings => ({
  timezone: "UTC",
  workHoursOnly: false,
  staleWarnHours: 4,
  staleLateHours: 24,
  ...overrides,
});
const workHours = (timezone = "UTC") =>
  settings({ workHoursOnly: true, timezone });

// 2026-10-21 is a Wednesday.
const date = (iso: string) => new Date(iso);

it("compares severities", () => {
  expect(isAtLeast("high", "normal")).toBe(true);
  expect(isAtLeast("normal", "normal")).toBe(true);
  expect(isAtLeast("low", "normal")).toBe(false);
});

describe("waitingFor", () => {
  it("counts all the time by default", () => {
    expect(
      waitingFor(
        "2026-10-23T17:00:00Z",
        date("2026-10-26T10:00:00Z"),
        settings(),
      ),
    ).toBe(65 * HOUR);
  });

  it("is zero for a time in the future", () => {
    expect(
      waitingFor(
        "2026-10-21T12:00:00Z",
        date("2026-10-21T11:00:00Z"),
        settings(),
      ),
    ).toBe(0);
  });

  describe("with work hours only", () => {
    it("counts time within a work day", () => {
      expect(
        waitingFor(
          "2026-10-21T10:00:00Z",
          date("2026-10-21T12:30:00Z"),
          workHours(),
        ),
      ).toBe(2.5 * HOUR);
    });

    it("skips time before 9 and after 6", () => {
      expect(
        waitingFor(
          "2026-10-21T07:00:00Z",
          date("2026-10-22T08:00:00Z"),
          workHours(),
        ),
      ).toBe(9 * HOUR);
    });

    it("skips the weekend", () => {
      // Friday 5pm to Monday 10am.
      expect(
        waitingFor(
          "2026-10-23T17:00:00Z",
          date("2026-10-26T10:00:00Z"),
          workHours(),
        ),
      ).toBe(2 * HOUR);
    });

    it("uses the user's timezone", () => {
      // 13:00 to 15:00 UTC is 9 to 11am in New York, and 10pm to midnight in Tokyo.
      const since = "2026-10-21T13:00:00Z";
      const now = date("2026-10-21T15:00:00Z");
      expect(waitingFor(since, now, workHours("America/New_York"))).toBe(
        2 * HOUR,
      );
      expect(waitingFor(since, now, workHours("Asia/Tokyo"))).toBe(0);
    });

    it("handles the clocks changing over a weekend", () => {
      // New York leaves daylight time on Sunday, Nov 1.
      // Friday 5pm EDT (21:00 UTC) to Monday 10am EST (15:00 UTC).
      expect(
        waitingFor(
          "2026-10-30T21:00:00Z",
          date("2026-11-02T15:00:00Z"),
          workHours("America/New_York"),
        ),
      ).toBe(2 * HOUR);
    });
  });
});

describe("staleLevel", () => {
  it.each([
    [0, "fresh"],
    [4 * HOUR - 1, "fresh"],
    [4 * HOUR, "warn"],
    [24 * HOUR - 1, "warn"],
    [24 * HOUR, "late"],
  ] as const)("%i ms is %s", (waited, level) => {
    expect(staleLevel(waited, settings())).toBe(level);
  });
});

describe("reminderStage", () => {
  const remind = (remindEveryHours: number | null) => ({
    ...settings(),
    remindEveryHours,
  });

  it.each([
    [4 * HOUR - 1, null],
    [4 * HOUR, "warn"],
    [24 * HOUR, "late"],
    [24 * HOUR + 4 * HOUR - 1, "late"],
    [24 * HOUR + 4 * HOUR, "late+1"],
    [24 * HOUR + 10 * HOUR, "late+2"],
  ])("%i ms, reminding every 4 hours, is %s", (waited, stage) => {
    expect(reminderStage(waited, remind(4))).toBe(stage);
  });

  it("stays at late with no reminders", () => {
    expect(reminderStage(100 * HOUR, remind(null))).toBe("late");
  });
});

describe("formatAge", () => {
  const now = date("2026-10-21T12:00:00Z");

  it.each([
    [-MINUTE, "0m"],
    [0, "0m"],
    [59 * 1000, "0m"],
    [12 * MINUTE, "12m"],
    [59 * MINUTE, "59m"],
    [3 * HOUR, "3h"],
    [24 * HOUR - 1, "23h"],
    [2 * 24 * HOUR + 5 * HOUR, "2d"],
  ] as const)("%i ms ago is %s", (ago, text) => {
    expect(formatAge(new Date(now.getTime() - ago), now)).toBe(text);
  });
});

describe("urgency", () => {
  const now = date("2026-10-21T12:00:00Z");
  const item = (overrides: Partial<UrgencyInput> = {}): UrgencyInput => ({
    kind: "review_requested",
    severity: "normal",
    waitingSince: "2026-10-21T11:00:00Z",
    occurredAt: "2026-10-21T11:00:00Z",
    unseen: false,
    waitingOnAuthor: false,
    ...overrides,
  });
  const score = (overrides: Partial<UrgencyInput> = {}) =>
    urgencyScore(item(overrides), settings(), now);

  it("starts from the severity", () => {
    expect(score({ severity: "low" })).toBe(100);
    expect(score()).toBe(200);
    expect(score({ severity: "high" })).toBe(300);
  });

  it("adds points as the wait gets long", () => {
    expect(score({ waitingSince: "2026-10-21T07:00:00Z" })).toBe(250);
    expect(score({ waitingSince: "2026-10-20T12:00:00Z" })).toBe(300);
  });

  it("counts only work hours toward staleness when chosen", () => {
    // Friday 5pm to Monday 10am: 65 real hours, but 2 work hours.
    const waited = item({ waitingSince: "2026-10-23T17:00:00Z" });
    const monday = date("2026-10-26T10:00:00Z");
    expect(urgencyScore(waited, settings(), monday)).toBe(300);
    expect(urgencyScore(waited, workHours(), monday)).toBe(200);
  });

  it("treats items with no wait as fresh", () => {
    expect(score({ waitingSince: null })).toBe(200);
  });

  it("adds points for re-requests and unseen items", () => {
    expect(score({ kind: "re_requested" })).toBe(240);
    expect(score({ unseen: true })).toBe(225);
  });

  it("puts items waiting on the author below the rest", () => {
    expect(
      score({ severity: "high", unseen: true, waitingOnAuthor: true }),
    ).toBeLessThan(score({ severity: "low" }));
  });

  it("sorts most urgent first, then newest", () => {
    const items = [
      item({ occurredAt: "2026-10-21T09:00:00Z" }),
      item({ severity: "low" }),
      item({ occurredAt: "2026-10-21T11:30:00Z" }),
      item({ severity: "high" }),
    ];
    expect([...items].sort(byUrgency(settings(), now))).toEqual([
      items[3],
      items[2],
      items[0],
      items[1],
    ]);
  });
});
