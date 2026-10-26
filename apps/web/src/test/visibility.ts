// Shows or hides the tab. setup.ts sets it back after each test.
export function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

// Hides the Mac app's window. The page can still count as visible then.
export function hideWindow() {
  window.dispatchEvent(new Event("pr-peek:hidden"));
}

export function resetVisibility() {
  Reflect.deleteProperty(document, "visibilityState");
}
