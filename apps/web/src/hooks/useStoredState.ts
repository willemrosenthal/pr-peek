import { useState } from "react";

// Like useState, but kept in localStorage. Falls back to `initial` if storage fails or
// holds something `isValid` rejects.
export function useStoredState<T>(
  key: string,
  initial: T,
  isValid: (value: unknown) => value is T,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      const parsed: unknown = stored === null ? initial : JSON.parse(stored);
      return isValid(parsed) ? parsed : initial;
    } catch {
      return initial;
    }
  });

  const update = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Private windows can block storage. The value still holds for this visit.
    }
  };
  return [value, update] as const;
}
