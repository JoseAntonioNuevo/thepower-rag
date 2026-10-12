import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { PROVIDER_ENV_VARIABLES } from "../../packages/contracts/src/limits";

function configuredValue(value: string | undefined): value is string {
  if (value === undefined) return false;
  const trimmed = value.trim();
  const marker = trimmed.toLowerCase();
  return trimmed.length > 0 && !marker.startsWith("replace-with") && !marker.startsWith("replace_");
}

function configuredRepoEnv(name: string): string | undefined {
  const file = path.resolve(import.meta.dirname, "../../.env");
  if (!existsSync(file)) return undefined;
  const value = parse(readFileSync(file, "utf8"))[name];
  if (typeof value !== "string" || !configuredValue(value)) return undefined;
  return value.trim();
}

const researchDev = process.env.CLOUDFLARE_ENV === "research";

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    cloudflare({
      // Only the explicit local-real profile opens the existing remote bindings.
      remoteBindings: process.env.CLOUDFLARE_ENV === "local",
      persistState: researchDev ? { path: ".wrangler/research-state" } : true,
      config(workerConfig) {
        if (command !== "serve" || researchDev) return;
        const vars = { ...workerConfig.vars };
        let changed = false;
        // Proveedor y claves del .env de la raíz, solo si la configuración del Worker no los trae.
        for (const name of PROVIDER_ENV_VARIABLES) {
          const value = configuredRepoEnv(name);
          const current = typeof vars[name] === "string" ? vars[name] : undefined;
          if (value && !configuredValue(current)) {
            vars[name] = value;
            changed = true;
          }
        }
        if (!changed) return;
        return { vars };
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: researchDev ? 5191 : 5173,
    strictPort: true,
    fs: {
      allow: [".", "../.."],
    },
  },
}));
