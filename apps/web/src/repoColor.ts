type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const toHex = (rgb: Rgb) =>
  `#${rgb.map((part) => Math.round(part).toString(16).padStart(2, "0")).join("")}`;

// Moves each channel `amount` (0 to 1) of the way to `target`.
const mix = (rgb: Rgb, target: number, amount: number): Rgb =>
  rgb.map((part) => part + (target - part) * amount) as Rgb;

// WCAG relative luminance, 0 for black to 1 for white.
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((part) => {
    const c = part / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG contrast ratio, 1 to 21.
function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

// Text color for a repo tag on `hex`: a lighter or darker shade of it, whichever reads
// better.
export function tagTextColor(hex: string): string {
  const background = toRgb(hex);
  const lighter = mix(background, 255, 0.85);
  const darker = mix(background, 0, 0.75);
  return toHex(
    contrast(background, lighter) >= contrast(background, darker)
      ? lighter
      : darker,
  );
}
