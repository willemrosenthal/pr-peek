// Makes the app icons in public/ from public/icon.svg. Run `pnpm icons` after changing it.
// Earlier icons are saved in icons/: PR Pal (git-buddy-icon.svg) and the blue mascot
// (blue-mascot-icon.svg).
import {
  defineConfig,
  minimal2023Preset as preset,
} from "@vite-pwa/assets-generator/config";

// The icon's violet, so icons that can't be see-through match it.
const background = "#5b2bd1";

export default defineConfig({
  preset: {
    ...preset,
    // Android crops these to a circle, so the legs need a little room.
    maskable: {
      ...preset.maskable,
      padding: 0.1,
      resizeOptions: { background },
    },
    // The icon already has room around the mascot. iOS rounds the corners itself.
    apple: { ...preset.apple, padding: 0, resizeOptions: { background } },
  },
  images: ["public/icon.svg"],
});
