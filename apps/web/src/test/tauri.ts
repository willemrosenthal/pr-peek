import { vi } from "vitest";

// Makes the page look like it's inside the Mac menu bar app. `answers` gives what each
// command returns. An Error answer fails, like a command the app doesn't know. Returns
// the fake `invoke` that receives command calls.
export function stubTauri(answers: Record<string, unknown> = {}) {
  const invoke = vi.fn((command: string, _args?: unknown) => {
    const answer = answers[command];
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer ?? null);
  });
  vi.stubGlobal("isTauri", true);
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke });
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
