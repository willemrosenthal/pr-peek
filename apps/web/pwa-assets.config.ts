// Makes the app icons in public/ from public/icon.svg. Run `pnpm icons` after changing it.
// The previous icon (PR Pal) is saved in icons/git-buddy-icon.svg.
import {
  defineConfig,
  minimal2023Preset as preset,
} from "@vite-pwa/assets-generator/config";

// The icon's blue, so icons that can't be see-through match it.
const background = "#0b57d0";

export default defineConfig({
  preset: {
    ...preset,
    maskable: { ...preset.maskable, resizeOptions: { background } },
    apple: { ...preset.apple, resizeOptions: { background } },
  },
  images: ["public/icon.svg"],
});
