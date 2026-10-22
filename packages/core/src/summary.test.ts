import { describe, expect, it } from "vitest";
import { ITEM_GROUPS } from "./api/items";
import type { ItemKind } from "./rules";
import {
  summaryDueDate,
  summaryText,
  type SummaryItem,
  type SummarySettings,
} from "./summary";

const NOW = new Date("2026-10-23T09:00:00Z");
const item = (kind: ItemKind, waitingSince: string | null = null) => ({
  kind,
  waitingSince,
});

describe("summaryText", () => {
  it("counts each kind, with the oldest review's wait", () => {
    const items: SummaryItem[] = [
      item("review_requested", "2026-10-21T09:00:00Z"),
      item("re_requested", "2026-10-23T06:00:00Z"),
      item("review_requested", "2026-10-22T09:00:00Z"),
      item("check_failed"),
      item("reviewed"),
      item("reviewed"),
      item("reply"),
    ];
    expect(summaryText(items, NOW)).toBe(
      "3 reviews waiting (oldest 2d), 1 failing check, 2 reviews of your PRs, 1 reply",
    );
  });

  it("names every kind", () => {
    for (const kind of Object.keys(ITEM_GROUPS) as ItemKind[]) {
      expect(summaryText([item(kind)], NOW)).toMatch(/^1 /);
    }
  });

  it("is null when nothing is open", () => {
    expect(summaryText([], NOW)).toBe(null);
  });
});

describe("summaryDueDate", () => {
  const settings = (
    overrides: Partial<SummarySettings> = {},
  ): SummarySettings => ({
    timezone: "UTC",
    digestTime: "09:00",
    lastSummaryDate: null,
    ...overrides,
  });
  const at = (time: string) => new Date(`2026-10-23T${time}:00Z`);

  it.each([
    ["08:59", null],
    ["09:00", "2026-10-23"],
    ["09:59", "2026-10-23"],
    ["10:00", null],
  ])("at %s: %s", (time, due) => {
    expect(summaryDueDate(settings(), at(time))).toBe(due);
  });

  it("sends once a day", () => {
    const sent = settings({ lastSummaryDate: "2026-10-23" });
    expect(summaryDueDate(sent, at("09:15"))).toBe(null);
  });

  it("dates a late summary by its time, even after midnight", () => {
    const late = settings({ digestTime: "23:50" });
    // The first run after 23:50 is at midnight.
    expect(summaryDueDate(late, new Date("2026-10-24T00:00:00Z"))).toBe(
      "2026-10-23",
    );
    // Sent at 23:45 for a 23:40 summary, so not again at midnight.
    const sent = settings({
      digestTime: "23:40",
      lastSummaryDate: "2026-10-23",
    });
    expect(summaryDueDate(sent, new Date("2026-10-24T00:00:00Z"))).toBe(null);
  });

  it("is never due with the summary off", () => {
    expect(summaryDueDate(settings({ digestTime: null }), at("09:00"))).toBe(
      null,
    );
  });

  it("uses the user's timezone and local date", () => {
    // 09:00 on Saturday in Auckland is still Friday in UTC.
    const auckland = settings({ timezone: "Pacific/Auckland" });
    expect(summaryDueDate(auckland, at("20:00"))).toBe("2026-10-24");
  });
});
