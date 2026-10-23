import { useSyncExternalStore } from "react";

// A setting kept on this device in localStorage. Every component reading it updates
// together. Falls back to `fallback` if storage fails or holds something `isValid`
// rejects.
export function localSetting<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
) {
  const listeners = new Set<() => void>();

  const get = (): T => {
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) return fallback;
      const value = parse(stored);
      return isValid(value) ? value : fallback;
    } catch {
      return fallback;
    }
  };

  const set = (value: T) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Private windows can block storage. The old value comes back next time.
    }
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { get, set, useValue: () => useSyncExternalStore(subscribe, get) };
}

// Older settings were saved as plain text, not JSON.
function parse(stored: string): unknown {
  try {
    return JSON.parse(stored);
  } catch {
    return stored;
  }
}
