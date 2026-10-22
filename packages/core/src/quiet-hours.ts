import { TZDate } from "@date-fns/tz";
import { isWeekend } from "date-fns";

// The user settings that decide when notifications wait. Match `UserSettings`.
export interface QuietSettings {
  timezone: string;
  // "HH:MM" in the user's timezone. Both null when quiet hours are off.
  quietStart: string | null;
  quietEnd: string | null;
  quietWeekends: boolean;
}

const minutesOf = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

// True during the user's quiet hours or a quiet weekend. Quiet hours can cross midnight,
// like 22:00 to 07:00. The same start and end means no quiet hours.
export function isQuiet(settings: QuietSettings, now: Date): boolean {
  const local = new TZDate(now, settings.timezone);
  if (settings.quietWeekends && isWeekend(local)) return true;
  if (settings.quietStart === null || settings.quietEnd === null) return false;

  const minute = local.getHours() * 60 + local.getMinutes();
  const start = minutesOf(settings.quietStart);
  const end = minutesOf(settings.quietEnd);
  return start <= end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}
