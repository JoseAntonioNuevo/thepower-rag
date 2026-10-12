// GUÍA DE LECTURA · scripts/anthropic-key.ts
// Lee del .env de la raíz las claves y variables del proveedor para los scripts locales, sin imprimirlas.
// Lectura de archivos.
import { existsSync, readFileSync } from "node:fs";
// Rutas.
import path from "node:path";
// Parser de .env.
import { parse } from "dotenv";
// Variables de proveedor y comprobación de marcadores.
import { PROVIDER_ENV_VARIABLES, isConfiguredValue } from "@thepower-rag/contracts";

// Valor configurado de una variable del .env.
function configuredEnvValue(root: string, name: string): string | undefined {
  // Ruta del .env.
  const file = path.join(root, ".env");
  // Sin archivo.
  if (!existsSync(file)) {
    // Nada.
    return undefined;
  }
  // Valor.
  const value = parse(readFileSync(file, "utf8"))[name];
  // Ausente o marcador.
  if (typeof value !== "string" || !isConfiguredValue(value)) {
    // Nada.
    return undefined;
  }
  // Valor sin espacios.
  return value.trim();
}

/** Reads ANTHROPIC_API_KEY from the repo `.env`. A replace-with marker counts as absent. */
export function readRepoAnthropicKey(root: string): string | undefined {
  // Delegado.
  return configuredEnvValue(root, "ANTHROPIC_API_KEY");
}

/** Reads ANTHROPIC_WORKSPACE_ID from the repo `.env`. A replace-with marker counts as absent. */
export function readRepoAnthropicWorkspaceId(root: string): string | undefined {
  // Delegado.
  return configuredEnvValue(root, "ANTHROPIC_WORKSPACE_ID");
}

/**
 * Reads the provider choice and every provider credential from the repo `.env`
 * (PROVIDER_ENV_VARIABLES). Markers and empty values count as absent and are left out.
 */
export function readRepoProviderEnv(root: string): Record<string, string> {
  // Variables encontradas.
  const found: Record<string, string> = {};
  // Cada variable de proveedor.
  for (const name of PROVIDER_ENV_VARIABLES) {
    // Valor.
    const value = configuredEnvValue(root, name);
    // Si existe, se guarda.
    if (value !== undefined) found[name] = value;
  }
  // Variables.
  return found;
}
