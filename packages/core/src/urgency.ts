import { TZDate } from "@date-fns/tz";
import { addDays, isWeekend, max, min, setHours, startOfDay } from "date-fns";
import type { ItemKind, Severity } from "./rules";

const HOUR_MS = 60 * 60 * 1000;
// Work hours, in the user's timezone.
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;

// The user settings that decide how long something has waited. Match `UserSettings`.
export interface WaitSettings {
  timezone: string;
  workHoursOnly: boolean;
  staleWarnHours: number;
  staleLateHours: number;
}

export type StaleLevel = "fresh" | "warn" | "late";

// Points for each part of the urgency score. Higher scores sort first.
export const URGENCY_WEIGHTS = {
  severity: { high: 300, normal: 200, low: 100 },
  stale: { fresh: 0, warn: 50, late: 100 },
  reRequested: 40,
  unseen: 25,
} as const;

// Time between `start` and `end` that falls Monday to Friday, 9 to 6, in `timeZone`.
function workTimeBetween(start: Date, end: Date, timeZone: string): number {
  let total = 0;
  for (
    let day = startOfDay(new TZDate(start, timeZone));
    day < end;
    day = addDays(day, 1)
  ) {
    if (isWeekend(day)) continue;
    const from = max([setHours(day, WORK_START_HOUR), start]);
    const to = min([setHours(day, WORK_END_HOUR), end]);
    total += Math.max(to.getTime() - from.getTime(), 0);
  }
  return total;
}

// How long an item has waited, in milliseconds, for its stale level.
// Only work hours count if the user chose that.
export function waitingFor(
  waitingSince: string | Date,
  now: Date,
  settings: WaitSettings,
): number {
  const since = new Date(waitingSince);
  if (since >= now) return 0;
  return settings.workHoursOnly
    ? workTimeBetween(since, now, settings.timezone)
    : now.getTime() - since.getTime();
}

export function staleLevel(
  waitedMs: number,
  settings: WaitSettings,
): StaleLevel {
  if (waitedMs >= settings.staleLateHours * HOUR_MS) return "late";
  if (waitedMs >= settings.staleWarnHours * HOUR_MS) return "warn";
  return "fresh";
}

// The real time since `since`, like "12m", "3h", or "2d", rounded down. Ignores work hours.
export function formatAge(since: string | Date, now: Date): string {
  const waitedMs = Math.max(now.getTime() - new Date(since).getTime(), 0);
  const minutes = Math.floor(waitedMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// The item fields the score needs. Dates are ISO strings. An `ItemDto` has them all.
export interface UrgencyInput {
  kind: ItemKind;
  severity: Severity;
  waitingSince: string | null;
  occurredAt: string;
  unseen: boolean;
}

export function urgencyScore(
  item: UrgencyInput,
  settings: WaitSettings,
  now: Date,
): number {
  const stale = item.waitingSince
    ? staleLevel(waitingFor(item.waitingSince, now, settings), settings)
    : "fresh";
  return (
    URGENCY_WEIGHTS.severity[item.severity] +
    URGENCY_WEIGHTS.stale[stale] +
    (item.kind === "re_requested" ? URGENCY_WEIGHTS.reRequested : 0) +
    (item.unseen ? URGENCY_WEIGHTS.unseen : 0)
  );
}

// Sorts items most urgent first. Ties go to the newest event.
export function byUrgency(settings: WaitSettings, now: Date) {
  return (a: UrgencyInput, b: UrgencyInput) =>
    urgencyScore(b, settings, now) - urgencyScore(a, settings, now) ||
    Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
}
