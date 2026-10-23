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
    showAuthors: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");
export type UpdateSettingsBody = z.infer<typeof updateSettingsBody>;

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
  hideBots: boolean;
  includeTeamRequests: boolean;
  // Shows each PR author's picture on the list.
  showAuthors: boolean;
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

export interface UpdateSettingsResponse {
  settings: UserSettingsDto;
}

export interface UpdateRuleResponse {
  rule: RuleSettingDto;
}
