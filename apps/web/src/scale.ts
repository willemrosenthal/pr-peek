import { localSetting } from "./localSetting";

// The sizes Settings offers, like Cmd- and Cmd+ in a browser. The normal one is in the
// middle, a little bigger than the browser's own size, which read small.
export const SCALES = [0.95, 1, 1.05, 1.1, 1.15];
export const NORMAL_SCALE = 1.05;

// What Settings calls a size: the normal one is 100%, and each step 5% more or less.
export const scaleLabel = (scale: number) =>
  `${Math.round((scale - NORMAL_SCALE) * 100) + 100}%`;

// Kept on this device, since screens differ. A size no longer offered, like 0.9, falls
// back to the normal one.
export const appScale = localSetting<number>(
  "pr-peek:scale",
  NORMAL_SCALE,
  (value): value is number => SCALES.includes(value as number),
);

// Sizes the app. global.css zooms #root by --scale.
export function applyScale(scale = appScale.get()) {
  document.documentElement.style.setProperty("--scale", String(scale));
}

export function setScale(scale: number) {
  appScale.set(scale);
  applyScale(scale);
}
