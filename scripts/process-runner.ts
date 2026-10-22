// GUÍA DE LECTURA · scripts/process-runner.ts
// Ejecuta wrangler como proceso hijo con un entorno mínimo: solo las variables necesarias y la cuenta.
// Lanzar procesos.
import { spawn } from "node:child_process";
// Tipo del resultado.
import type { ProcessRun } from "./wrangler-parse";

// Ejecutor de comandos.
export interface ProcessRunner {
  // Ejecuta con argumentos y entorno.
  run(args: readonly string[], env: Readonly<Record<string, string>>): Promise<ProcessRun>;
}

// Variables del sistema que pasan a wrangler; las demás (claves incluidas) no.
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

// Entorno acotado con la cuenta indicada.
export function scopedWranglerEnv(
  source: NodeJS.ProcessEnv,
  accountId: string,
): Record<string, string> {
  // Entorno vacío.
  const env: Record<string, string> = {};
  // Cada variable permitida.
  for (const key of PASSED_ENV) {
    // Valor.
    const value = source[key];
    // Si existe.
    if (value !== undefined) {
      // Se copia.
      env[key] = value;
    }
  }
  // Cuenta de Cloudflare.
  env.CLOUDFLARE_ACCOUNT_ID = accountId;
  // Entorno.
  return env;
}

// Ejecutor de wrangler con node.
export function createWranglerRunner(wranglerPath: string, cwd: string): ProcessRunner {
  // Método run.
  return {
    // Ejecuta la operación del puerto y devuelve su resultado al llamador.
    run(args, env) {
      // Promesa con código y salidas.
      return new Promise((resolve) => {
        // Proceso sin shell y sin entrada.
        const child = spawn(process.execPath, [wranglerPath, ...args], {
          cwd,
          env: { ...env },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        // Salida estándar.
        let stdout = "";
        // Errores.
        let stderr = "";
        // Texto UTF-8.
        child.stdout.setEncoding("utf8");
        // Texto UTF-8.
        child.stderr.setEncoding("utf8");
        // Acumula la salida.
        child.stdout.on("data", (chunk: string) => {
          // Suma.
          stdout += chunk;
        });
        // Acumula los errores.
        child.stderr.on("data", (chunk: string) => {
          // Suma.
          stderr += chunk;
        });
        // No se pudo lanzar.
        child.on("error", () => {
          // Código 1.
          resolve({ code: 1, stdout, stderr: `${stderr}\nno se pudo iniciar wrangler` });
        });
        // Al terminar.
        child.on("close", (code) => {
          // Código y salidas.
          resolve({ code, stdout, stderr });
        });
      });
    },
  };
}
