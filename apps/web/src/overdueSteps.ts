// The hours a review's orange and red can be set to: 1, 2, 4, 8, and 12 hours, then whole
// days up to 30, the server's limit.
export const OVERDUE_STEPS = [
  1,
  2,
  4,
  8,
  12,
  ...Array.from({ length: 30 }, (_, day) => (day + 1) * 24),
];

// The step after `hours`, or null at the top. A saved value between steps, like 6,
// moves to the step past it.
export const stepAfter = (hours: number) =>
  OVERDUE_STEPS.find((step) => step > hours) ?? null;

// The step before `hours`, or null at the bottom.
export const stepBefore = (hours: number) =>
  OVERDUE_STEPS.findLast((step) => step < hours) ?? null;
