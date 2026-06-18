import { defineConfig } from "tsup";

// Build only the CLI bin. The Pi extension, skills, and core/*.ts ship as TS
// source (jiti/Vite consume them directly); only the bin needs to run under a
// plain `node` on any version, so we bundle it - and only it - to dist/tl.js.
// The bundle pulls in core/state-ops and its pure dependencies; it has no npm
// runtime deps (typebox is only used by the Pi extension, not the CLI).
export default defineConfig({
  entry: { tl: "bin/tl.ts" },
  format: ["esm"],
  platform: "node",
  target: "node18",
  bundle: true,
  clean: true,
  outDir: "dist",
  minify: false,
  // Preserve the #!/usr/bin/env node shebang from bin/tl.ts so the published
  // bin is directly executable.
  banner: {},
});
