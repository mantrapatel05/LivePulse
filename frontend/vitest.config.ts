import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const rootDir = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    css: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "LivePulse/**"],
    // Forks pool + single worker: threads pool OOMs the vitest child on
    // memory-constrained Windows dev machines ("Timeout waiting for worker
    // to respond"). Forks isolate per file with lower overhead; maxWorkers 1
    // trades speed for reliability on local runs. CI with more RAM can
    // override via --pool=threads --maxWorkers=4.
    pool: "forks",
    maxWorkers: 1,
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
});
