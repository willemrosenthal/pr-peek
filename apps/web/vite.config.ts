import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

// The API server's port, from the root .env.
const apiPort = loadEnv("development", "../..", "").PORT || "3000";

export default defineConfig({
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
