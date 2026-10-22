// Shows or hides the tab. setup.ts sets it back after each test.
export function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

export function resetVisibility() {
  Reflect.deleteProperty(document, "visibilityState");
}
