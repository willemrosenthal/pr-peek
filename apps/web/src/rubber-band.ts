// How far something moves when pulled `distance`, like a rubber band: about as far at
// first, then less and less, and never past `max`.
export const rubberBand = (distance: number, max: number) =>
  max * (1 - 1 / (1 + Math.max(0, distance) / max));
