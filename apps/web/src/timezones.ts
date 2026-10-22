// The browser's timezone, like "Europe/Paris".
export const detectedTimezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

// Every timezone the browser knows, plus `zone` if the list lacks it, like "UTC".
export function timezoneOptions(zone: string): string[] {
  const all = Intl.supportedValuesOf("timeZone");
  return all.includes(zone) ? all : [zone, ...all];
}
