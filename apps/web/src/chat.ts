// GUÍA DE LECTURA · apps/web/src/chat.ts
// Punto único de importación del chat para la interfaz: el tipo de mensaje del curso y el transporte HTTP.
// Tipo de mensaje con metadatos y partes de datos del curso.
export type { CourseUIMessage } from "@thepower-rag/contracts";
// Transporte de useChat que envía los mensajes por POST a /api/chat.
export { DefaultChatTransport } from "ai";
