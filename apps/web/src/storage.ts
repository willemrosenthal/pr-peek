// A saved text value, or null. Private windows can block storage, so a blocked read
// finds nothing and a blocked write is skipped.
export function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Saves `value`, or removes it when null.
export function store(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Blocked: the next read just finds nothing.
  }
}
