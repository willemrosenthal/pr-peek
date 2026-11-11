import { inIosApp, rememberShell } from "./hooks/useIsTray";
import { linkLeavingApp } from "./links";

// The iPhone app (plan 12) loads this site. Links to PRs and other sites open in Safari
// (or the GitHub app), not inside it. window.open asks the app to open them there.
function openLinksInSafari(event: MouseEvent) {
  const href = linkLeavingApp(event);
  if (!href) return;
  event.preventDefault();
  window.open(href, "_blank");
}

// Run once at startup. Returns a function that stops it, for tests.
export function startIos(): () => void {
  if (!inIosApp()) return () => undefined;
  // Signing in leaves the site and comes back without `?shell=ios`.
  rememberShell();
  document.documentElement.classList.add("ios-app");
  document.addEventListener("click", openLinksInSafari, true);
  return () => {
    document.documentElement.classList.remove("ios-app");
    document.removeEventListener("click", openLinksInSafari, true);
  };
}
