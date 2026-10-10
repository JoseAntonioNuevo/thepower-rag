import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { isConfiguredValue } from "@thepower-rag/contracts";

function configuredEnvValue(root: string, name: string): string | undefined {
  const file = path.join(root, ".env");
  if (!existsSync(file)) {
    return undefined;
  }
  const value = parse(readFileSync(file, "utf8"))[name];
  if (typeof value !== "string" || !isConfiguredValue(value)) {
    return undefined;
  }
  return value.trim();
}

/** Reads ANTHROPIC_API_KEY from the repo `.env`. A replace-with marker counts as absent. */
export function readRepoAnthropicKey(root: string): string | undefined {
  return configuredEnvValue(root, "ANTHROPIC_API_KEY");
}

/** Reads ANTHROPIC_WORKSPACE_ID from the repo `.env`. A replace-with marker counts as absent. */
export function readRepoAnthropicWorkspaceId(root: string): string | undefined {
  return configuredEnvValue(root, "ANTHROPIC_WORKSPACE_ID");
}
