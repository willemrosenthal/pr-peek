import { execFileSync } from "node:child_process";
import { sentryVitePlugin } from "@sentry/vite-plugin";
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
// release tag on it, when this copy of the repo has the tag (docs/completed/15-auto-release.md).
// A commit with no tag of its own, like on a branch, gets the last release before it.
function buildInfo() {
  const commit = process.env.RENDER_GIT_COMMIT || git("rev-parse", "HEAD");
  const release = (...args: string[]) =>
    commit
      ? git("describe", "--tags", "--match", "v*", ...args, commit).replace(
          /^v/,
          "",
        )
      : "";
  const version = release("--exact-match");
  return { version, after: version ? "" : release("--abbrev=0"), commit };
}

const build = buildInfo();
// Lets the build send its source maps to Sentry, so stack traces show our code, not the
// minified build. Set on Render only. Without it, the Sentry plugin does nothing.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

export default defineConfig({
  define: {
    __BUILD__: JSON.stringify(build),
  },
  build: {
    // Made for Sentry, but not linked from the built files.
    sourcemap: "hidden",
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
        // "Share to Git Buddy" on Android, for a PR link (SharePage).
        share_target: {
          action: "/add",
          method: "GET",
          params: { title: "title", text: "text", url: "url" },
        },
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
    // Last, so it sees the final files. Uploads the source maps, then deletes them, so
    // they aren't served.
    sentryVitePlugin({
      org: "willem-rosenthal",
      project: "git-buddy-web",
      authToken: sentryAuthToken,
      disable: !sentryAuthToken,
      release: { name: build.commit },
      sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
      telemetry: false,
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
