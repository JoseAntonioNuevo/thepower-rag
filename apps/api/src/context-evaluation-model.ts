// GUÍA DE LECTURA · apps/api/src/context-evaluation-model.ts
// Reexporta generateText del AI SDK para los scripts locales de evaluación con presupuesto
// (scripts/evaluate-course-context.ts). El Worker público no importa ni enruta este módulo.
// generateText: una llamada al modelo que devuelve el texto completo, sin streaming.
export { generateText } from "ai";
