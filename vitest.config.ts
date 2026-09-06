import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
