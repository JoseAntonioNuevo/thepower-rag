// GUÍA DE LECTURA · scripts/ingest-plan.ts
// Imprime el plan de ingesta sin ejecutarlo; una variable de entorno nunca basta para autorizarla.
// Líneas del plan.
import { planLines } from "./activation";

// Imprime el plan.
console.log(planLines(null).join("\n"));
// Si alguien intenta autorizar por entorno.
if (process.env.THEPOWER_RAG_INGEST === "authorized") {
  // Aviso.
  console.log("la autorización de entorno no ejecuta la ingesta");
  // Termina con código 2.
  process.exitCode = 2;
}
