// The link a click opens, when it should leave the app for the browser: one to another
// site, or one that asks for a new tab. Null for links that stay, and for other clicks.
export function linkLeavingApp(event: MouseEvent): string | null {
  const link = (event.target as Element | null)?.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement)) return null;
  const external = new URL(link.href).origin !== location.origin;
  return link.target === "_blank" || external ? link.href : null;
}
