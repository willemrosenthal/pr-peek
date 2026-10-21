import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/worker.ts"],
  format: "esm",
  target: "node24",
  platform: "node",
  clean: true,
  sourcemap: true,
  // Core is TypeScript source, so it must be bundled in, not loaded at runtime.
  noExternal: ["@pr-peek/core"],
});
