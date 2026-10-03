import { spawn } from "node:child_process";
import type { ProcessRun } from "./wrangler-parse";

export interface ProcessRunner {
  run(args: readonly string[], env: Readonly<Record<string, string>>): Promise<ProcessRun>;
}

const PASSED_ENV = [
  "HOME",
  "PATH",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "SHELL",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
] as const;

export function scopedWranglerEnv(
  source: NodeJS.ProcessEnv,
  accountId: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASSED_ENV) {
    const value = source[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  env.CLOUDFLARE_ACCOUNT_ID = accountId;
  return env;
}

export function createWranglerRunner(wranglerPath: string, cwd: string): ProcessRunner {
  return {
    run(args, env) {
      return new Promise((resolve) => {
        const child = spawn(process.execPath, [wranglerPath, ...args], {
          cwd,
          env: { ...env },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.on("error", () => {
          resolve({ code: 1, stdout, stderr: `${stderr}\nno se pudo iniciar wrangler` });
        });
        child.on("close", (code) => {
          resolve({ code, stdout, stderr });
        });
      });
    },
  };
}
