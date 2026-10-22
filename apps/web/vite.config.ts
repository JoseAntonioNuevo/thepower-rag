// GUÍA DE LECTURA · apps/web/vite.config.ts
// Vite de la web: React, el plugin de Cloudflare que ejecuta el Worker en workerd durante el desarrollo y
// el servidor local en 127.0.0.1. En `vp dev` copia proveedor y claves del .env de la raíz al Worker.
// Lectura de archivos.
import { existsSync, readFileSync } from "node:fs";
// Rutas.
import path from "node:path";
// Parser de archivos .env.
import { parse } from "dotenv";
// Plugin de Cloudflare: Worker y bindings en local.
import { cloudflare } from "@cloudflare/vite-plugin";
// Plugin de React.
import react from "@vitejs/plugin-react";
// defineConfig de Vite+.
import { defineConfig } from "vite-plus";
// Nombres de las variables de proveedor que se copian.
import { PROVIDER_ENV_VARIABLES } from "../../packages/contracts/src/limits";

// ¿Valor configurado? Ni vacío ni un marcador de plantilla.
function configuredValue(value: string | undefined): value is string {
  // Sin valor.
  if (value === undefined)
    // Rechaza esta condición y comunica el resultado negativo al llamador.
    return false;
  // Sin espacios.
  const trimmed = value.trim();
  // Minúsculas.
  const marker = trimmed.toLowerCase();
  // Configurado si no está vacío ni empieza por replace.
  return trimmed.length > 0 && !marker.startsWith("replace-with") && !marker.startsWith("replace_");
}

// Valor de una variable del .env de la raíz, si está configurado.
function configuredRepoEnv(name: string): string | undefined {
  // Ruta del .env.
  const file = path.resolve(import.meta.dirname, "../../.env");
  // Sin archivo.
  if (!existsSync(file))
    // Indica que esta rama no ha producido un valor disponible para el llamador.
    return undefined;
  // Valor de la variable.
  const value = parse(readFileSync(file, "utf8"))[name];
  // Sin valor útil.
  if (typeof value !== "string" || !configuredValue(value))
    // Indica que esta rama no ha producido un valor disponible para el llamador.
    return undefined;
  // Valor sin espacios.
  return value.trim();
}

// ¿Perfil de investigación durable? (CLOUDFLARE_ENV=research).
const researchDev = process.env.CLOUDFLARE_ENV === "research";

// Configuración según el comando (serve o build).
export default defineConfig(({ command }) => ({
  // Plugins.
  plugins: [
    // React.
    react(),
    // Cloudflare.
    cloudflare({
      // Bindings remotos solo con CLOUDFLARE_ENV=local (perfil local con datos reales).
      remoteBindings: process.env.CLOUDFLARE_ENV === "local",
      // Estado local persistente (otra carpeta para investigación).
      persistState: researchDev ? { path: ".wrangler/research-state" } : true,
      // Ajusta la configuración del Worker antes de arrancarlo.
      config(workerConfig) {
        // Solo en vp dev y fuera de investigación.
        if (command !== "serve" || researchDev)
          // Termina esta rama sin ejecutar los pasos siguientes del recorrido.
          return;
        // Variables actuales.
        const vars = { ...workerConfig.vars };
        // ¿Se añadió alguna?
        let changed = false;
        // Proveedor y claves del .env de la raíz, solo si la configuración del Worker no los trae.
        // Cada variable de proveedor.
        for (const name of PROVIDER_ENV_VARIABLES) {
          // Valor del .env.
          const value = configuredRepoEnv(name);
          // Valor del Worker.
          const current = typeof vars[name] === "string" ? vars[name] : undefined;
          // Si el .env la trae y el Worker no.
          if (value && !configuredValue(current)) {
            // La copia.
            vars[name] = value;
            // Marca el cambio.
            changed = true;
          }
        }
        // Sin cambios.
        if (!changed)
          // Termina esta rama sin ejecutar los pasos siguientes del recorrido.
          return;
        // Variables nuevas.
        return { vars };
      },
    }),
  ],
  // Servidor de desarrollo.
  server: {
    // Solo este equipo.
    host: "127.0.0.1",
    // Puerto 5191 en investigación; 5173 en el resto.
    port: researchDev ? 5191 : 5173,
    // Si el puerto está ocupado, falla en vez de cambiarlo.
    strictPort: true,
    // Archivos que puede servir.
    fs: {
      // La web y la raíz del monorepo.
      allow: [".", "../.."],
    },
  },
}));
