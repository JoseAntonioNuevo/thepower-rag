import { defineConfig } from "vite-plus";

export default defineConfig({
  defaultPackage: "./apps/web",
  fmt: {
    semi: true,
    singleQuote: false,
  },
  lint: {
    plugins: ["typescript"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
    overrides: [
      {
        files: ["apps/web/**"],
        plugins: ["react"],
      },
      {
        files: ["**/*.test.ts"],
        plugins: ["vitest"],
      },
      {
        files: ["scripts/**"],
        rules: {
          "no-console": "off",
        },
      },
    ],
  },
  test: {
    include:
      process.env.THEPOWER_ENTRYPOINT === "1"
        ? ["scripts/entrypoint-offline.integration.ts", "scripts/research-workerd.integration.ts"]
        : ["apps/**/*.test.ts", "packages/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    testTimeout: process.env.THEPOWER_ENTRYPOINT === "1" ? 180_000 : 20_000,
  },
});
