// GUÍA DE LECTURA · apps/api/src/research-worker.ts
// Punto de entrada del Worker con investigación durable: además del manejador HTTP normal exporta
// la clase del Workflow de Cloudflare que ejecuta cada trabajo de investigación.
// Clase del Workflow que Cloudflare instancia por nombre.
export { ResearchJobWorkflow } from "./research-workflow";
// El mismo manejador fetch del Worker principal.
export { default } from "./worker";
