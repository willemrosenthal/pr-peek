import { inIosApp } from "./hooks/useIsTray";

// How strong a tick is:
// - firm: a long press opens something.
// - light: a pull or a swipe goes far enough to act.
// - selection: a switch, a picker, or a segmented choice changes.
// - success: something worked, like copying a link.
export type Haptic = "firm" | "light" | "selection" | "success";

// Whether the phone can buzz at any moment (Android). iPhones' browsers can't.
export const canVibrate = () => typeof navigator.vibrate === "function";

// Whether a tick works at any moment, even while a finger is down or moving: in the
// iPhone app (plan 12) and on Android. Elsewhere it only works right after a tap or a
// finger lifting.
export const canTickAnytime = () => inIosApp() || canVibrate();

// A short tick, where the device has one. The iPhone app ticks with the phone's own
// haptics, at each strength. Android vibrates. iPhones' browsers have no vibrate, but iOS
// 18 and later tick when a switch checkbox flips, so this flips a hidden one. Apple
// doesn't promise that, so it may stop working, and it only works right after a tap or
// a finger lifting.
export function haptic(kind: Haptic) {
  if (inIosApp()) {
    void import("./native")
      .then(({ nativeHaptic }) => nativeHaptic(kind))
      .catch(() => undefined);
    return;
  }
  if (canVibrate()) {
    navigator.vibrate(10);
    return;
  }
  const label = document.createElement("label");
  label.ariaHidden = "true";
  label.style.display = "none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  label.append(input);
  document.head.append(label);
  label.click();
  label.remove();
}
