const DAY_MS = 24 * 60 * 60 * 1000;

export const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

// Whole days until a token expires, part of a day counting as one. 0 or less once it has.
export const daysLeft = (
  expiresAt: Date | string,
  now: Date | number = Date.now(),
) =>
  Math.ceil((new Date(expiresAt).getTime() - new Date(now).getTime()) / DAY_MS);
