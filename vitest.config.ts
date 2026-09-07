import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    // DB-touching tests share one on-disk SQLite file (dev.db) rather than
    // standing up a dedicated test database (see conversation record for
    // why: simplicity at this project's scale). SQLite's writer
    // concurrency is limited enough that running test FILES in parallel
    // produced intermittent lock/FK errors under load. Tests within a file
    // already run sequentially by default; this just extends that across
    // files too. Documented tradeoff, not a workaround for a real bug.
    fileParallelism: false,
    // Most tests are plain Node (DB integration, pure functions) and stay
    // on the default "node" environment above. A handful of React
    // component tests need a DOM — rather than paying jsdom's setup cost
    // globally, those files opt in individually via a
    // `/** @vitest-environment jsdom */` docblock at the top of the file.
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
