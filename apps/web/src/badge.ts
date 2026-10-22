// Shows a count on the installed app's icon, where the browser supports it. 0 clears it.
export function setBadge(count: number) {
  if (!("setAppBadge" in navigator)) return;
  // Fails when the browser doesn't allow badges right now.
  navigator.setAppBadge(count).catch(() => undefined);
}
