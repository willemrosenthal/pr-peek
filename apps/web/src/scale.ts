import { localSetting } from "./localSetting";

// The sizes Settings offers, like Cmd- and Cmd+ in a browser. 1 is the normal size.
export const SCALES = [0.9, 1, 1.1, 1.2];

// Kept on this device, since screens differ.
export const appScale = localSetting<number>(
  "pr-peek:scale",
  1,
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
