// GUÍA DE LECTURA · vite.config.ts
// Configuración de Vite+ para todo el monorepo: formato, lint con tipos y tests (normales o de entrada).
// defineConfig da tipos y autocompletado a la configuración.
import { defineConfig } from "vite-plus";

// Configuración exportada.
export default defineConfig({
  // Paquete por defecto de los comandos vp.
  defaultPackage: "./apps/web",
  // Formato del código (vp fmt).
  fmt: {
    // Con punto y coma.
    semi: true,
    // Comillas dobles.
    singleQuote: false,
  },
  // Lint (vp check).
  lint: {
    // Reglas de TypeScript.
    plugins: ["typescript"],
    // Opciones del lint.
    options: {
      // Usa la información de tipos.
      typeAware: true,
      // También comprueba los tipos.
      typeCheck: true,
    },
    // Reglas generales.
    rules: {
      // Prohíbe console.log; permite warn y error.
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
    // Excepciones por carpeta.
    overrides: [
      // La web añade reglas de React.
      {
        files: ["apps/web/**"],
        plugins: ["react"],
      },
      // Los tests añaden reglas de Vitest.
      {
        files: ["**/*.test.ts"],
        plugins: ["vitest"],
      },
      // Los scripts pueden escribir en consola.
      {
        files: ["scripts/**"],
        rules: {
          "no-console": "off",
        },
      },
    ],
  },
  // Tests (vp test).
  test: {
    // Con THEPOWER_ENTRYPOINT=1 solo las pruebas de entrada con workerd; si no, los tests unitarios.
    include:
      process.env.THEPOWER_ENTRYPOINT === "1"
        ? [
            "scripts/entrypoint-offline.integration.ts",
            "scripts/research-workerd.integration.ts",
            "scripts/research-durable.workerd.ts",
          ]
        : ["apps/**/*.test.ts", "packages/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    // Entorno Node.
    testTimeout: process.env.THEPOWER_ENTRYPOINT === "1" ? 180_000 : 20_000,
  // Plazo por test: 180 s en las de entrada y 20 s en el resto.
  },
});
