import { onTestFinished, vi } from "vitest";

// Makes the page look like it's inside the Mac menu bar app. Returns the fake `invoke`
// that receives command calls.
export function stubTauri() {
  const invoke = vi.fn((_command: string, _args?: unknown) =>
    Promise.resolve(),
  );
  vi.stubGlobal("isTauri", true);
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke });
  onTestFinished(() => localStorage.removeItem("pr-peek:count-style"));
  return invoke;
}

// The arguments of each call to `command`.
export const callsOf = (
  invoke: ReturnType<typeof stubTauri>,
  command: string,
) =>
  invoke.mock.calls
    .filter(([name]) => name === command)
    .map(([, args]) => args);
