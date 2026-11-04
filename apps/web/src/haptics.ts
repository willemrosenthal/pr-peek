// Whether the phone can buzz at any moment (Android). iPhones can't.
export const canVibrate = () => typeof navigator.vibrate === "function";

// A short buzz, where the phone has one. Android vibrates. iPhones have no vibrate, but
// iOS 18 and later tick when a switch checkbox flips, so this flips a hidden one. Apple
// doesn't promise that, so it may stop working. It also only works right after a tap or
// a finger lifting, not while a finger moves.
export function haptic() {
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
