import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
    alias: {
      "^src/(.*)$": "/home/kaydo/Desktop/cc-platform/src/$1",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});