import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const serverOnlyAlias = {
  "server-only": fileURLToPath(
    new URL("./tests/setup/server-only.ts", import.meta.url),
  ),
};

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: serverOnlyAlias,
  },
  test: {
    coverage: {
      reporter: ["text", "html"],
    },
    projects: [
      {
        plugins: [tsconfigPaths()],
        resolve: {
          alias: serverOnlyAlias,
        },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.contract.test.{ts,tsx}"],
        },
      },
      {
        plugins: [tsconfigPaths()],
        resolve: {
          alias: serverOnlyAlias,
        },
        test: {
          name: "architecture",
          environment: "node",
          include: ["tests/architecture/**/*.test.ts"],
        },
      },
      {
        plugins: [tsconfigPaths()],
        resolve: {
          alias: serverOnlyAlias,
        },
        test: {
          name: "contracts",
          environment: "node",
          include: [
            "src/**/*.contract.test.{ts,tsx}",
            "tests/contracts/**/*.test.ts",
          ],
        },
      },
      {
        plugins: [tsconfigPaths()],
        resolve: {
          alias: serverOnlyAlias,
        },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
        },
      },
    ],
  },
});
