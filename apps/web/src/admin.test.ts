import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  egressPace,
  fillSeries,
  formatBytes,
  formatMs,
  readings,
} from "./admin";
import { niceMax } from "./components/BarChart";
import { adminOverview } from "./test/fake-api";

const GB = 1024 * 1024 * 1024;
const base = adminOverview();

describe("formatting", () => {
  it.each([
    [512, "512 B"],
    [38 * 1024 * 1024, "38 MB"],
    [1.44 * GB, "1.4 GB"],
  ])("shows %i bytes as %s", (bytes, shown) => {
    expect(formatBytes(bytes)).toBe(shown);
  });

  it.each([
    [840, "840 ms"],
    [4200, "4.2 s"],
  ])("shows %i ms as %s", (ms, shown) => {
    expect(formatMs(ms)).toBe(shown);
  });

  it.each([
    [0, 1],
    [7, 10],
    [120, 200],
    [318, 500],
  ])("tops a scale at %i with %i", (max, top) => {
    expect(niceMax(max)).toBe(top);
  });
});

describe("fillSeries", () => {
  it("fills the days the server left out with 0", () => {
    const end = new Date("2026-10-21T00:00:00Z");
    const series = fillSeries(
      [{ at: "2026-10-20T00:00:00.000Z", value: 5 }],
      end,
      3,
      DAY_MS,
    );
    expect(
      series.map((p) => [p.at.toISOString().slice(0, 10), p.value]),
    ).toEqual([
      ["2026-10-19", 0],
      ["2026-10-20", 5],
      ["2026-10-21", 0],
    ]);
  });
});

describe("egressPace", () => {
  it("takes the month so far to its end", () => {
    // 20.5 days into a 31 day month.
    const pace = egressPace(
      adminOverview({ egress: { ...base.egress, thisMonth: 2.05 * GB } }),
    );
    expect(pace / GB).toBeCloseTo(3.1);
  });

  it("doesn't guess in the first day of the month", () => {
    const overview = adminOverview({
      at: "2026-11-01T06:00:00.000Z",
      egress: { ...base.egress, thisMonth: GB },
    });
    expect(egressPace(overview)).toBe(GB);
  });
});

describe("readings", () => {
  const watched = (overview = base) =>
    readings(overview)
      .filter((r) => r.watch)
      .map((r) => r.label);

  it("finds nothing to look at on a quiet server", () => {
    expect(watched()).toEqual([]);
  });

  it("flags each reading past its rule", () => {
    expect(
      watched(
        adminOverview({
          health: {
            dbBytes: 400 * 1024 * 1024,
            jobRows: 3000,
            syncingUsers: 20,
            lateUsers: 2,
            failingUsers: 6,
          },
          egress: { ...base.egress, thisMonth: 3 * GB },
          github: { requests: 9, lowestBudget: 800, rateLimited: 1 },
        }),
      ),
    ).toEqual([
      "Database size",
      "Egress this month",
      "Job table",
      "Syncs on time",
      "Failing syncs",
      "GitHub budget",
    ]);
  });

  it("says so when the job table or GitHub budget is unknown", () => {
    const shown = readings(
      adminOverview({
        health: { ...base.health, jobRows: null },
        github: { ...base.github, lowestBudget: null },
      }),
    );
    expect(shown.find((r) => r.label === "Job table")?.value).toBe("Unknown");
    expect(shown.find((r) => r.label === "GitHub budget")?.value).toBe(
      "No requests yet",
    );
  });
});
