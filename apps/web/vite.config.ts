import { execFileSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

// The API server's port, from the root .env.
const apiPort = loadEnv("development", "../..", "").PORT || "3000";

// Runs git, or gives "" if it fails.
function git(...args: string[]) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

// What's being built, for Settings. Render gives the commit. The version comes from the
// release tag on it, when this copy of the repo has the tag (docs/15-auto-release.md).
function buildInfo() {
  const commit = process.env.RENDER_GIT_COMMIT || git("rev-parse", "HEAD");
  const tag = commit
    ? git("describe", "--tags", "--exact-match", "--match", "v*", commit)
    : "";
  return { version: tag.replace(/^v/, ""), commit };
}

export default defineConfig({
  define: {
    __BUILD__: JSON.stringify(buildInfo()),
  },
  plugins: [
    react(),
    VitePWA({
      // We write the service worker, so plan 08 can add push handling to it.
      strategies: "injectManifest",
      srcDir: "src/sw",
      filename: "sw.ts",
      // Asks before updating. See UpdatePrompt.
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        id: "/",
        name: "Git Buddy",
        short_name: "Git Buddy",
        description: "The pull requests waiting on you, in one list.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // Upright only. Android follows this once the app is installed. iPhones don't.
        orientation: "portrait",
        // --color-page in tokens.css.
        background_color: "#f2f2f5",
        theme_color: "#f2f2f5",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    // Same origin as the app, so cookies and the Origin check work like in production.
    proxy: { "/api": `http://localhost:${apiPort}` },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
  },
});
