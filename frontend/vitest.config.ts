import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      // `lcov` is what SonarQube's `sonar.javascript.lcov.reportPaths` reads;
      // `text` keeps the summary visible in CI logs; `json-summary` is what the
      // threshold gate below and any tooling can parse without re-running.
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      // Report on every source file, not just the ones a test happened to
      // import — otherwise an untested module silently counts as 0 files
      // rather than 0%.
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test-setup.ts",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/**/*.d.ts",
        "src/features/connections/connectionTestFixtures.ts",
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
