import { TZDate } from "@date-fns/tz";
import { format, subMinutes } from "date-fns";
import { minutesOf } from "./quiet-hours";
import type { ItemKind } from "./rules";
import { formatAge } from "./urgency";

// How long after the summary time it can still go out, if the worker was down.
const SUMMARY_WINDOW_MINUTES = 60;
const DAY_MINUTES = 24 * 60;

// The item fields the summary needs. An `ItemDto` has them all.
export interface SummaryItem {
  kind: ItemKind;
  waitingSince: string | null;
}

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

// Each part of the summary and the kinds it counts. Every kind is in one part.
const PARTS: { kinds: ItemKind[]; one: string; many: string }[] = [
  {
    kinds: ["review_requested", "re_requested"],
    one: "review waiting",
    many: "reviews waiting",
  },
  { kinds: ["check_failed"], one: "failing check", many: "failing checks" },
  {
    kinds: ["reviewed"],
    one: "review of your PR",
    many: "reviews of your PRs",
  },
  { kinds: ["reply"], one: "reply", many: "replies" },
  { kinds: ["mention"], one: "mention", many: "mentions" },
  {
    kinds: ["commented"],
    one: "comment on your PR",
    many: "comments on your PRs",
  },
];

// One line about the open items, like "3 reviews waiting (oldest 2d), 1 failing check".
// Null when nothing is open.
export function summaryText(items: SummaryItem[], now: Date): string | null {
  const parts = PARTS.flatMap(({ kinds, one, many }) => {
    const matching = items.filter((item) => kinds.includes(item.kind));
    if (matching.length === 0) return [];
    const text = count(matching.length, one, many);
    const oldest = matching
      .map((item) => item.waitingSince)
      .filter((since) => since !== null)
      .sort()[0];
    return [oldest ? `${text} (oldest ${formatAge(oldest, now)})` : text];
  });
  return parts.length > 0 ? parts.join(", ") : null;
}

// The user settings that decide when the summary goes out. Match `UserSettings`.
export interface SummarySettings {
  timezone: string;
  // "HH:MM" in the user's timezone, or null when the summary is off.
  digestTime: string | null;
  // The user's local date ("YYYY-MM-DD") of the last summary sent.
  lastSummaryDate: string | null;
}

// The local date of the summary that's due now, or null. It's due in the hour after the
// summary time, once a day. That hour can run past midnight, so the date is the one the
// summary time fell on.
export function summaryDueDate(
  settings: SummarySettings,
  now: Date,
): string | null {
  if (settings.digestTime === null) return null;
  const local = new TZDate(now, settings.timezone);
  const minute = local.getHours() * 60 + local.getMinutes();
  const since =
    (minute - minutesOf(settings.digestTime) + DAY_MINUTES) % DAY_MINUTES;
  if (since >= SUMMARY_WINDOW_MINUTES) return null;

  const date = format(subMinutes(local, since), "yyyy-MM-dd");
  return date === settings.lastSummaryDate ? null : date;
}
