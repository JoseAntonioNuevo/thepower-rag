import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { cloudflare } from "@cloudflare/vite-plugin";
import { isConfiguredValue } from "@thepower-rag/contracts";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

function configuredRepoEnv(name: string): string | undefined {
  const file = path.resolve(import.meta.dirname, "../../.env");
  if (!existsSync(file)) return undefined;
  const value = parse(readFileSync(file, "utf8"))[name];
  if (typeof value !== "string" || !isConfiguredValue(value)) return undefined;
  return value.trim();
}

export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      // Only the explicit local-real profile opens the existing remote bindings.
      remoteBindings: process.env.CLOUDFLARE_ENV === "local",
      config(workerConfig) {
        const vars = { ...workerConfig.vars };
        let changed = false;
        const key = configuredRepoEnv("ANTHROPIC_API_KEY");
        const currentKey =
          typeof vars.ANTHROPIC_API_KEY === "string" ? vars.ANTHROPIC_API_KEY : undefined;
        if (key && !isConfiguredValue(currentKey)) {
          vars.ANTHROPIC_API_KEY = key;
          changed = true;
        }
        const workspaceId = configuredRepoEnv("ANTHROPIC_WORKSPACE_ID");
        const currentWorkspace =
          typeof vars.ANTHROPIC_WORKSPACE_ID === "string" ? vars.ANTHROPIC_WORKSPACE_ID : undefined;
        if (workspaceId && !isConfiguredValue(currentWorkspace)) {
          vars.ANTHROPIC_WORKSPACE_ID = workspaceId;
          changed = true;
        }
        if (!changed) return;
        return { vars };
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: {
      allow: [".", "../.."],
    },
  },
});
