import { z } from "zod";
import type { Channel, ItemKind, RuleGroup, Severity } from "../rules";

// A timezone Node knows, including "UTC" and old names like "US/Eastern".
export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// "HH:MM", 24 hour clock.
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, like 09:30");
const staleHours = z
  .int()
  .min(1)
  .max(24 * 30);

// Where the list shows PR authors' pictures: nowhere, only under Needs my review, or on
// every row.
export const SHOW_AUTHORS = ["off", "review", "all"] as const;
export type ShowAuthors = (typeof SHOW_AUTHORS)[number];

export const updateSettingsBody = z
  .object({
    timezone: z.string().max(100).refine(isTimeZone, "Unknown timezone"),
    staleWarnHours: staleHours,
    staleLateHours: staleHours,
    workHoursOnly: z.boolean(),
    remindEveryHours: z
      .int()
      .min(1)
      .max(24 * 7)
      .nullable(),
    quietStart: timeOfDay.nullable(),
    quietEnd: timeOfDay.nullable(),
    quietWeekends: z.boolean(),
    highBreaksQuiet: z.boolean(),
    digestTime: timeOfDay.nullable(),
    hideBots: z.boolean(),
    includeTeamRequests: z.boolean(),
    showAuthors: z.enum(SHOW_AUTHORS),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");
export type UpdateSettingsBody = z.infer<typeof updateSettingsBody>;

// The times the server keeps a copy of, and where. The copy stays when the time is
// turned off, so turning quiet hours or the summary back on brings the user's own back.
const KEPT_TIMES = {
  quietStart: "keptQuietStart",
  quietEnd: "keptQuietEnd",
  digestTime: "keptDigestTime",
} as const;

type KeptTime = keyof typeof KEPT_TIMES;

// The kept copies a save changes: one for each time it sets. Turning a time off sets
// nothing, so its copy stays.
export function keptTimes(
  changes: Partial<Record<KeptTime, string | null | undefined>>,
): Partial<Record<(typeof KEPT_TIMES)[KeptTime], string>> {
  return Object.fromEntries(
    (Object.keys(KEPT_TIMES) as KeptTime[]).flatMap((field) => {
      const time = changes[field];
      return time ? [[KEPT_TIMES[field], time]] : [];
    }),
  );
}

export interface UserSettingsDto {
  timezone: string;
  staleWarnHours: number;
  staleLateHours: number;
  workHoursOnly: boolean;
  // Hours between reminders once a review request is red. Null for none.
  remindEveryHours: number | null;
  quietStart: string | null;
  quietEnd: string | null;
  quietWeekends: boolean;
  // High severity notifications still arrive during quiet hours.
  highBreaksQuiet: boolean;
  digestTime: string | null;
  // The last quiet hours and summary time set, kept while those are off. Null until set.
  keptQuietStart: string | null;
  keptQuietEnd: string | null;
  keptDigestTime: string | null;
  hideBots: boolean;
  includeTeamRequests: boolean;
  showAuthors: ShowAuthors;
}

export const severity = z.enum(["low", "normal", "high"]);
// Turning a rule off is `enabled: false`, so at least one channel.
export const channels = z
  .array(z.enum(["list", "push"]))
  .min(1)
  .refine((list) => new Set(list).size === list.length, "Duplicate channel");

export const ruleOptions = z
  .object({
    // Review requests on draft PRs. Set on the review requested rule.
    includeDrafts: z.boolean(),
  })
  .partial();
export type RuleOptions = z.infer<typeof ruleOptions>;

export const updateRuleBody = z
  .object({
    enabled: z.boolean(),
    severity,
    channels,
    options: ruleOptions,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");
export type UpdateRuleBody = z.infer<typeof updateRuleBody>;

// One rule with its defaults and the user's choices.
export interface RuleSettingDto {
  id: ItemKind;
  name: string;
  group: RuleGroup;
  defaultSeverity: Severity;
  defaultChannels: Channel[];
  enabled: boolean;
  severity: Severity;
  channels: Channel[];
  options: RuleOptions;
}

export interface SettingsResponse {
  settings: UserSettingsDto;
  rules: RuleSettingDto[];
}

// Set when the save changes what the rules find. The next sync runs them on every PR, so
// the list is updating until a sync that started at or after this time ends. ISO string.
interface ListUpdate {
  listUpdatingSince: string | null;
}

export interface UpdateSettingsResponse extends ListUpdate {
  settings: UserSettingsDto;
}

export interface UpdateRuleResponse extends ListUpdate {
  rule: RuleSettingDto;
}
