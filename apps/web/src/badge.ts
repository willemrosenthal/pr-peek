// Shows a count on the installed app's icon, where the browser supports it. 0 clears it.
export async function setBadge(count: number) {
  if (!("setAppBadge" in navigator)) return;
  // Fails when the browser doesn't allow badges right now.
  await navigator.setAppBadge(count).catch(() => undefined);
}
