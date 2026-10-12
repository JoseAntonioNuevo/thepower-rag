// GUÍA DE LECTURA · packages/contracts/src/chat.ts
// Contrato de la petición de chat que el navegador envía a /api/chat.
// Define con Zod cada parte de un mensaje, valida el historial completo y convierte los
// errores de validación en una lista corta de campos para la respuesta 400.
// Zod declara esquemas: describen la forma de los datos y los validan en tiempo de ejecución.
import { z } from "zod";
// Esquemas de CRAG que viajan dentro de los mensajes del asistente.
import { cragSummarySchema, demoScenarioSchema } from "./crag";
// Grupo del curso, citas, eventos de la demo y traza del RAG.
import { audienceSchema, citationSchema, demoEventSchema, traceEventSchema } from "./domain";
// Límites compartidos (longitudes, número de mensajes y de partes).
import { LIMITS } from "./limits";
// Esquemas de la investigación de S12 que también viajan en los mensajes.
import { researchScenarioSchema, researchSourceSchema, researchSummarySchema } from "./research";

// Las cuatro etapas de la aplicación; el navegador elige una en cada petición.
export const chatModeSchema = z.enum(["sin-rag", "rag", "crag", "research"]);

// Tipo TypeScript deducido del esquema: "sin-rag" | "rag" | "crag" | "research".
export type ChatMode = z.infer<typeof chatModeSchema>;

// Parte de texto normal de un mensaje.
const textPartSchema = z.object({
  // Discriminante: indica qué clase de parte es.
  type: z.literal("text"),
  // Texto con el tope de una respuesta del asistente.
  text: z.string().max(LIMITS.maxAssistantMessageChars),
});

// Parte con el evento etiquetado de la demostración sin modelo.
const demoPartSchema = z.object({
  type: z.literal("data-demo"),
  data: demoEventSchema.extend({
    label: z.string().max(LIMITS.maxMessageChars),
  }),
});

// Parte con una cita (fragmento del corpus) que respalda la respuesta.
const sourcePartSchema = z.object({
  type: z.literal("data-source"),
  data: citationSchema,
});

// Parte con la traza del RAG: consulta, puntuaciones y decisión.
const tracePartSchema = z.object({
  type: z.literal("data-trace"),
  data: traceEventSchema,
});

// Parte con el resumen del grafo CRAG.
const cragPartSchema = z.object({
  type: z.literal("data-crag"),
  data: cragSummarySchema,
});

// Parte con el resumen de una investigación de S12.
const researchPartSchema = z.object({
  type: z.literal("data-research"),
  data: researchSummarySchema,
});

// Parte con una fuente externa citada por la investigación.
const researchSourcePartSchema = z.object({
  type: z.literal("data-research-source"),
  data: researchSourceSchema,
});

// Una parte puede ser cualquiera de las anteriores; Zod elige el esquema según el campo type.
const messagePartSchema = z.discriminatedUnion("type", [
  textPartSchema,
  demoPartSchema,
  sourcePartSchema,
  tracePartSchema,
  cragPartSchema,
  researchPartSchema,
  researchSourcePartSchema,
]);

// Mensaje del historial con su identificador, su papel y sus partes.
export const chatMessageSchema = z
  .object({
    // Identificador del mensaje generado por el navegador.
    id: z.string().min(1).max(LIMITS.maxIdChars),
    // Solo dos papeles: el alumno (user) y el asistente (assistant).
    role: z.enum(["user", "assistant"]),
    // Al menos una parte y como mucho las del límite.
    parts: z.array(messagePartSchema).min(1).max(LIMITS.maxPartsPerMessage),
  })
  // Reglas que no caben en la forma: se comprueban después y añaden errores con nombre.
  .superRefine((message, context) => {
    // Un mensaje del alumno no puede traer citas, trazas ni otros datos: solo texto.
    if (message.role === "user" && message.parts.some((part) => part.type !== "text")) {
      // Error de validación en el campo parts.
      context.addIssue({
        code: "custom",
        path: ["parts"],
        message: "Los mensajes del usuario solo admiten texto.",
      });
    }
    // El tope de longitud del alumno es más estricto que el del asistente.
    if (message.role === "user") {
      // Recorre cada parte del mensaje.
      for (const part of message.parts) {
        // Texto del alumno más largo que el límite.
        if (part.type === "text" && part.text.length > LIMITS.maxUserMessageChars) {
          // Añade el error con el límite en el mensaje.
          context.addIssue({
            code: "custom",
            path: ["parts"],
            message: `El mensaje del usuario supera ${String(LIMITS.maxUserMessageChars)} caracteres.`,
          });
        }
      }
    }
  });

// Tipo de un mensaje ya validado.
export type ChatMessage = z.infer<typeof chatMessageSchema>;

// Une el texto de todas las partes de tipo texto de un mensaje.
export function messageText(message: ChatMessage): string {
  // flatMap descarta las partes que no son texto y join las concatena sin separador.
  return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

// Petición completa de /api/chat: etapa, grupo, guion opcional e historial.
export const chatRequestSchema = z
  .object({
    // Etapa pedida.
    mode: chatModeSchema,
    // Grupo del alumno; si no llega, el programa completo.
    audience: audienceSchema.default("program"),
    // Guion de la demo de CRAG (solo en modo demostración).
    demoScenario: demoScenarioSchema.optional(),
    // Guion de la demo de investigación.
    researchScenario: researchScenarioSchema.optional(),
    // Historial con al menos un mensaje y como mucho el límite.
    messages: z.array(chatMessageSchema).min(1).max(LIMITS.maxHistoryMessages),
  })
  // Reglas sobre la petición completa.
  .superRefine((value, context) => {
    // El guion de investigación solo tiene sentido en esa etapa.
    if (value.researchScenario !== undefined && value.mode !== "research") {
      // Error en el campo researchScenario.
      context.addIssue({
        code: "custom",
        path: ["researchScenario"],
        message: "El guion de investigación solo vale en la etapa de investigación.",
      });
    }
    // Suma los caracteres de texto de todo el historial.
    const total = value.messages.reduce((sum, message) => sum + messageText(message).length, 0);
    // Historial demasiado largo: se rechaza la petición.
    if (total > LIMITS.maxHistoryChars) {
      // Error en el campo messages con el límite.
      context.addIssue({
        code: "custom",
        path: ["messages"],
        message: `El historial supera ${String(LIMITS.maxHistoryChars)} caracteres.`,
      });
    }

    // Último mensaje del historial; at(-1) devuelve undefined si la lista está vacía.
    const last = value.messages.at(-1);
    // La conversación tiene que terminar con una pregunta del alumno con texto.
    if (last === undefined || last.role !== "user" || messageText(last).trim().length === 0) {
      // Error que explica la regla.
      context.addIssue({
        code: "custom",
        path: ["messages"],
        message: "El último mensaje debe ser del usuario y no puede estar vacío.",
      });
    }
  });

// Tipo de una petición ya validada.
export type ChatRequest = z.infer<typeof chatRequestSchema>;

// Error de un campo para la respuesta 400.
export interface FieldIssue {
  // Ruta del campo, con puntos (por ejemplo messages.0.parts).
  path: string;
  // Explicación legible del error.
  message: string;
}

// Convierte un error de Zod en una lista corta de errores por campo.
export function issuesFrom(error: z.ZodError): FieldIssue[] {
  // Solo los primeros maxIssues; cada ruta se une con puntos.
  return error.issues.slice(0, LIMITS.maxIssues).map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join("."),
    message: issue.message,
  }));
}
