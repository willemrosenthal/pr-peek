import type { AdminOverviewResponse } from "@pr-peek/core";

// The admin page's numbers, worked out from the server's answer. Kept apart from the
// page so they're easy to test.

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
// Each person's GitHub budget, and where it's worth a look.
const GITHUB_BUDGET = 5000;
const GITHUB_WATCH = 1000;

const UNITS = ["B", "KB", "MB", "GB", "TB"];

// Like "38 MB" or "1.4 GB": one decimal under 10.
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value);
  return `${shown} ${UNITS[unit]}`;
}

// Like "840 ms" or "4.2 s".
export const formatMs = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;

export const formatCount = (n: number) => n.toLocaleString("en-US");

export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

const formatShare = (share: number) => `${Math.round(share * 100)}%`;

export interface Point {
  at: Date;
  value: number;
}

// `count` points, `stepMs` apart, ending at `end`. The server leaves out days and hours
// with nothing, so those come back as 0.
export function fillSeries(
  points: { at: string; value: number }[],
  end: Date,
  count: number,
  stepMs: number,
): Point[] {
  const values = new Map(
    points.map((p) => [new Date(p.at).getTime(), p.value]),
  );
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(end.getTime() - (count - 1 - i) * stepMs);
    return { at, value: values.get(at.getTime()) ?? 0 };
  });
}

export const startOfDay = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

export const startOfHour = (at: Date) =>
  new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);

// What this month's egress comes to by its end, at the pace so far.
export function egressPace(overview: AdminOverviewResponse): number {
  const at = new Date(overview.at);
  const daysInMonth = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const daysSoFar =
    (at.getTime() - Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)) /
    DAY_MS;
  // Too early in the month to guess from: the first hour would multiply by 700.
  if (daysSoFar < 1) return overview.egress.thisMonth;
  return (overview.egress.thisMonth / daysSoFar) * daysInMonth;
}

export interface Reading {
  label: string;
  value: string;
  detail: string;
  // The rule for when it's worth a look.
  rule: string;
  // How full, 0 to 1, for the bar under it.
  share: number;
  watch: boolean;
}

const clamp = (share: number) =>
  Number.isFinite(share) ? Math.min(Math.max(share, 0), 1) : 0;

// The readings at the top of the page, each with its rule.
export function readings(overview: AdminOverviewResponse): Reading[] {
  const { health, limits, egress, github } = overview;
  const users = (n: number) => (n === 1 ? "1 user" : `${formatCount(n)} users`);

  const pace = egressPace(overview);
  const egressWatch = limits.egressBytesPerMonth * limits.egressWatchShare;
  // Expected rows, but never under one user's worth, so a quiet server isn't flagged.
  const expectedRows = Math.max(health.syncingUsers, 1) * limits.jobRowsPerUser;

  return [
    {
      label: "Database size",
      value: formatBytes(health.dbBytes),
      detail: `of the ${formatBytes(limits.dbBytes)} free plan`,
      rule: `Worth a look past ${formatShare(limits.dbWatchShare)}.`,
      share: clamp(health.dbBytes / limits.dbBytes),
      watch: health.dbBytes > limits.dbBytes * limits.dbWatchShare,
    },
    {
      label: "Egress this month",
      value: formatBytes(egress.thisMonth),
      detail: `of ${formatBytes(limits.egressBytesPerMonth)}. On pace for ${formatBytes(pace)}.`,
      rule: `Worth a look when on pace for over ${formatBytes(egressWatch)}.`,
      share: clamp(egress.thisMonth / limits.egressBytesPerMonth),
      watch: pace > egressWatch,
    },
    health.jobRows === null
      ? {
          label: "Job table",
          value: "Unknown",
          detail: "Couldn't read pg-boss's job table.",
          rule: `Worth a look past twice ${formatCount(limits.jobRowsPerUser)} rows a user.`,
          share: 0,
          watch: false,
        }
      : {
          label: "Job table",
          value: `${formatCount(health.jobRows)} rows`,
          detail: `About ${formatCount(expectedRows)} expected: ${formatCount(limits.jobRowsPerUser)} a user.`,
          rule: `Worth a look past ${formatCount(expectedRows * 2)}.`,
          share: clamp(health.jobRows / (expectedRows * 2)),
          watch: health.jobRows > expectedRows * 2,
        },
    {
      label: "Syncs on time",
      value: `${formatCount(health.lateUsers)} late`,
      detail: `${users(health.syncingUsers)} syncing.`,
      rule: "Late is 15 minutes past their interval.",
      share: clamp(health.lateUsers / health.syncingUsers),
      watch: health.lateUsers > 0,
    },
    {
      label: "Failing syncs",
      value: users(health.failingUsers),
      detail: `${formatCount(health.failingUsers)} of ${users(health.syncingUsers)} failed 3 times in a row.`,
      rule: `Worth a look past ${formatShare(limits.failingShare)} of users.`,
      share: clamp(health.failingUsers / health.syncingUsers),
      watch: health.failingUsers > health.syncingUsers * limits.failingShare,
    },
    github.lowestBudget === null
      ? {
          label: "GitHub budget",
          value: "No requests yet",
          detail: "None today.",
          rule: `Worth a look under ${formatCount(GITHUB_WATCH)} left.`,
          share: 0,
          watch: false,
        }
      : {
          label: "GitHub budget",
          value: `${formatCount(github.lowestBudget)} left`,
          detail: `The lowest on any request today, of ${formatCount(GITHUB_BUDGET)} an hour.`,
          rule: `Worth a look under ${formatCount(GITHUB_WATCH)} left.`,
          share: clamp(1 - github.lowestBudget / GITHUB_BUDGET),
          watch: github.lowestBudget < GITHUB_WATCH,
        },
  ];
}
