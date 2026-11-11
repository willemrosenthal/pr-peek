import { EXPIRING_DAYS } from "@pr-peek/core";
import { describe, expect, it } from "vitest";
import {
  formatHours,
  notificationsStatus,
  reposStatus,
  tokensStatus,
} from "./settingsStatus";
import { githubToken, settingsResponse } from "./test/fake-api";

const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(NOW + days * DAY_MS).toISOString();

it("shows whole days as days, and the rest as hours", () => {
  expect(formatHours(4)).toBe("4 h");
  expect(formatHours(36)).toBe("36 h");
  expect(formatHours(24)).toBe("1 day");
  expect(formatHours(72)).toBe("3 days");
});

it("says when there are no repos yet", () => {
  expect(reposStatus([])).toBe("None yet");
});

it("shows the summary when quiet hours are off", () => {
  const { settings } = settingsResponse({ digestTime: "09:00" });
  expect(notificationsStatus(settings)).toBe("Summary at 9:00 AM");
  expect(notificationsStatus({ ...settings, digestTime: null })).toBe(
    "Quiet hours off",
  );
});

describe("tokensStatus", () => {
  it("counts working tokens", () => {
    expect(tokensStatus([], NOW)).toEqual({ text: "None added" });
    expect(tokensStatus([githubToken()], NOW)).toEqual({ text: "1 token" });
  });

  it("warns about the soonest to expire", () => {
    const soon = githubToken({ expiresAt: inDays(EXPIRING_DAYS - 2) });
    expect(tokensStatus([githubToken(), soon], NOW)).toEqual({
      text: `1 expires in ${EXPIRING_DAYS - 2} days`,
      tone: "warning",
    });
    const sooner = githubToken({ id: "t2", expiresAt: inDays(1) });
    expect(tokensStatus([soon, sooner], NOW)).toEqual({
      text: "2 expiring soon",
      tone: "warning",
    });
  });

  it("puts a stopped token first", () => {
    const stopped = githubToken({ status: "stopped" });
    const soon = githubToken({ expiresAt: inDays(1) });
    expect(tokensStatus([soon, stopped], NOW)).toEqual({
      text: "1 stopped working",
      tone: "danger",
    });
  });
});
