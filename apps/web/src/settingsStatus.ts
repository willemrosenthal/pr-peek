import {
  daysLeft,
  plural,
  type RuleSettingDto,
  type TokenDto,
  type UserSettingsDto,
  type WatchedRepoDto,
} from "@pr-peek/core";
import type { Tone } from "./components/LinkRow";
import { stateOf } from "./tokens";

// The one-line statuses on the settings home screen, like "6 watched · 1 muted".

const joined = (parts: (string | false)[]) => parts.filter(Boolean).join(" · ");

// "24 h", or whole days as "2 days".
export const formatHours = (hours: number) =>
  hours % 24 === 0 ? plural(hours / 24, "day") : `${hours} h`;

// "18:00" as the device shows times, like "6:00 PM".
export function formatTime(time: string) {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function reposStatus(repos: WatchedRepoDto[]) {
  if (repos.length === 0) return "None yet";
  const paused = repos.filter((repo) => !repo.enabled).length;
  const muted = repos.filter((repo) => repo.enabled && repo.muted).length;
  return joined([
    `${repos.length} watched`,
    muted > 0 && `${muted} muted`,
    paused > 0 && `${paused} paused`,
  ]);
}

export function rulesStatus(rules: RuleSettingDto[]) {
  const on = rules.filter((rule) => rule.enabled);
  const notify = on.filter((rule) => rule.channels.includes("push")).length;
  return joined([
    `${on.length} of ${rules.length} on`,
    notify > 0 && `${notify} notify`,
  ]);
}

export const overdueStatus = (settings: UserSettingsDto) =>
  `Orange after ${formatHours(settings.staleWarnHours)}, red after ${formatHours(settings.staleLateHours)}`;

export function notificationsStatus(settings: UserSettingsDto) {
  const { quietStart, quietEnd, digestTime } = settings;
  if (quietStart && quietEnd) {
    return `Quiet ${formatTime(quietStart)} to ${formatTime(quietEnd)}`;
  }
  if (digestTime) return `Summary at ${formatTime(digestTime)}`;
  return "Quiet hours off";
}

// The token that needs a look first: a stopped one, then the soonest to expire.
export function tokensStatus(
  tokens: TokenDto[],
  now = Date.now(),
): { text: string; tone?: Tone } {
  if (tokens.length === 0) return { text: "None added" };
  const stopped = tokens.filter((token) => stateOf(token, now) === "stopped");
  if (stopped.length > 0) {
    return { text: `${stopped.length} stopped working`, tone: "danger" };
  }
  const expiring = tokens
    .filter((token) => stateOf(token, now) === "expiring")
    .map((token) => daysLeft(token.expiresAt!, now))
    .sort((a, b) => a - b);
  const [soonest] = expiring;
  if (soonest !== undefined) {
    const text =
      expiring.length > 1
        ? `${expiring.length} expiring soon`
        : soonest > 0
          ? `1 expires in ${plural(soonest, "day")}`
          : "1 expired";
    return { text, tone: "warning" };
  }
  return { text: plural(tokens.length, "token") };
}
