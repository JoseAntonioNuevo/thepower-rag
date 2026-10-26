// GUÍA DE LECTURA · packages/contracts/src/domain.ts
// Tipos del dominio del curso que comparten navegador y API: grupos, citas, decisiones de
// evidencia, consumo, coste, metadatos de cada ejecución, traza del RAG y estado de capacidades.
// Zod declara y valida la forma de los datos.
import { z } from "zod";
// Límites compartidos de longitud.
import { LIMITS } from "./limits";

// Las dos cohortes del curso: lunes/miércoles (L/X) y martes/jueves (M/J).
export const cohortSchema = z.enum(["L/X", "M/J"]);

// Tipo con los dos identificadores de cohorte.
export type CohortId = z.infer<typeof cohortSchema>;

// Audiencia de una pregunta: el programa completo o una cohorte concreta.
export const audienceSchema = z.enum(["program", "L/X", "M/J"]);

// Tipo con las tres audiencias.
export type Audience = z.infer<typeof audienceSchema>;

// Veredicto sobre la evidencia recuperada; status indica cuál de las tres formas es.
export const evidenceDecisionSchema = z.discriminatedUnion("status", [
  // La evidencia basta para responder.
  z.object({
    // Estado suficiente.
    status: z.literal("sufficient"),
    // Motivo del veredicto.
    reason: z.string(),
  }),
  // La evidencia cubre solo una parte.
  z.object({
    // Estado parcial.
    status: z.literal("partial"),
    // Motivo del veredicto.
    reason: z.string(),
    // Lagunas concretas que faltan por cubrir.
    gaps: z.array(z.string()),
  }),
  // La evidencia no permite responder.
  z.object({
    // Estado insuficiente.
    status: z.literal("insufficient"),
    // Motivo del veredicto.
    reason: z.string(),
  }),
]);

// Tipo de una decisión sobre la evidencia.
export type EvidenceDecision = z.infer<typeof evidenceDecisionSchema>;

// Cita que acompaña a una respuesta: de qué documento y fragmento sale y qué dice.
export const citationSchema = z.object({
  // Documento del corpus (por ejemplo, s05-langgraph).
  documentId: z.string(),
  // Fragmento concreto dentro del documento.
  chunkId: z.string(),
  // Título del documento.
  title: z.string(),
  // Sección del fragmento.
  section: z.string(),
  // Extracto mostrado al alumno, con tope de longitud.
  excerpt: z.string().max(LIMITS.maxMessageChars),
  // Versión del corpus de la que sale el fragmento.
  corpusVersion: z.string(),
});

// Tipo de una cita.
export type Citation = z.infer<typeof citationSchema>;

// Tokens consumidos en una ejecución; null significa desconocido, no cero.
export const runUsageSchema = z.object({
  // Tokens de entrada (instrucciones, historial y fragmentos).
  inputTokens: z.number().int().nonnegative().nullable(),
  // Tokens generados.
  outputTokens: z.number().int().nonnegative().nullable(),
  // Total que informa el proveedor.
  totalTokens: z.number().int().nonnegative().nullable(),
});

// Coste estimado de una respuesta.
export const runCostSchema = z.object({
  // Importe.
  amount: z.number().finite(),
  // Moneda (USD).
  currency: z.string().min(1),
  // Quién aporta la tarifa (por ejemplo, Anthropic u OpenRouter).
  source: z.string().min(1),
  // Cómo se calculó: tarifa publicada o configurada.
  method: z.string().min(1),
});

// Metadatos de una respuesta que el navegador muestra junto al texto.
export const runMetadataSchema = z.object({
  // Identificador único de la ejecución.
  runId: z.string().min(1).max(LIMITS.maxIdChars),
  // Origen: demo sin modelo, canalización de prueba, proveedor real o grafo.
  origin: z.enum(["offline-demo", "offline-fixture", "provider", "pipeline"]),
  // Modelo que respondió; null en la demo.
  modelId: z.string().nullable(),
  // Identificador de las instrucciones usadas.
  promptId: z.string(),
  // Cómo terminó: en curso, completa, parcial, cancelada, con error, rechazada o aclarada.
  completion: z.enum([
    "streaming",
    "complete",
    "partial",
    "aborted",
    "error",
    "refused",
    "clarified",
  ]),
  // Consumo de tokens, o null si no se conoce.
  usage: runUsageSchema.nullable(),
  // Coste estimado, o null si no se conoce.
  cost: runCostSchema.nullable(),
});

// Tipo de los metadatos de una ejecución.
export type RunMetadata = z.infer<typeof runMetadataSchema>;

// Evento de la demostración offline: siempre sin consumo ni coste.
export const demoEventSchema = z.object({
  // Marca fija de la demo.
  kind: z.literal("offline-demo"),
  // Texto de la etiqueta visible.
  label: z.string(),
  // La demo no consume tokens.
  usage: z.null(),
  // La demo no tiene coste.
  cost: z.null(),
});

// Tipo de un evento de la demo.
export type DemoEvent = z.infer<typeof demoEventSchema>;

// Traza del RAG que se enseña en clase: qué se buscó, qué se recuperó y qué se decidió.
export const traceEventSchema = z.object({
  // Consulta enviada al índice.
  query: z.string(),
  // Si hubo reformulación pendiente o se usó el contexto completo.
  queryRewrite: z.enum(["pending", "context-complete"]),
  // Versión del corpus consultada.
  corpusVersion: z.string().nullable(),
  // Modelo de embeddings usado.
  embedding: z.string(),
  // Explicación de qué significa la puntuación de ese índice.
  scoreMeaning: z.string(),
  // Fragmentos recuperados con su puntuación y si se usaron.
  retrieved: z.array(
    z.object({
      chunkId: z.string(),
      score: z.number().finite().nullable(),
      selected: z.boolean(),
    }),
  ),
  // Decisión: responder, rechazar o pedir aclaración.
  decision: z.enum(["answer", "refuse", "clarify"]),
  // Si se llamó al modelo generador.
  generation: z.enum(["called", "skipped"]),
  // Mensaje de estado legible.
  status: z.string(),
});

// Tipo de una traza.
export type TraceEvent = z.infer<typeof traceEventSchema>;

// Paso del RAG básico para el modo clase: se emite al abrir la respuesta (búsqueda medida en el
// servidor) y durante la generación, para recorrer el grafo en directo y repetirlo después.
export const ragStepSchema = z.object({
  // Nodo del grafo: embedding, búsqueda, umbral, generación, respuesta, rechazo o aclaración.
  kind: z.enum(["embed", "search", "threshold", "generate", "answer", "refuse", "clarify"]),
  // Texto de estado legible.
  status: z.string().min(1).max(240),
  // Pregunta o consulta del paso.
  query: z.string().max(500),
  // Modelo que actúa en el paso (embeddings o generador), o null si decide el código.
  model: z.string().max(128).nullable(),
  // Duración medida en el servidor, o null si no se midió.
  durationMs: z.number().int().min(0).nullable(),
  // Umbral de similitud aplicado, o null si el paso no lo usa.
  threshold: z.number().finite().nullable(),
  // Candidatos con su puntuación y si pasan al generador.
  candidates: z
    .array(
      z.object({
        chunkId: z.string().min(1).max(128),
        score: z.number().finite().nullable(),
        selected: z.boolean(),
      }),
    )
    .max(10),
});

// Tipo de un paso del RAG básico.
export type RagStep = z.infer<typeof ragStepSchema>;

// Estado de cada capacidad en /api/health.
export const capabilityStatusSchema = z.enum([
  "offline-demo",
  "offline-fixture",
  "ready",
  "blocked",
  "not-implemented",
]);

// Tipo con los cinco estados posibles.
export type CapabilityStatus = z.infer<typeof capabilityStatusSchema>;
