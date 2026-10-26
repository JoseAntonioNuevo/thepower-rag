// GUÍA DE LECTURA · packages/contracts/src/ui-message.ts
// Tipo del mensaje que viaja por el stream del AI SDK entre la API y React: texto, metadatos
// de la ejecución y partes de datos con nombre (citas, traza, CRAG, investigación).
// UIMessage es el tipo genérico de mensaje de interfaz del AI SDK; import type no carga código.
import type { UIMessage } from "ai";
// Tipos de CRAG.
import type { CragStep, CragSummary } from "./crag";
// Tipos de citas, demo, metadatos y traza.
import type { Citation, DemoEvent, RagStep, RunMetadata, TraceEvent } from "./domain";
// Tipos de la investigación de S12.
import type { ResearchSource, ResearchStep, ResearchSummary } from "./research";

// Partes de datos que puede llevar un mensaje; la clave es el nombre (data-<clave> en el stream).
export type CourseDataParts = {
  // Evento de la demostración sin modelo.
  demo: DemoEvent;
  // Cita de un fragmento del corpus.
  source: Citation;
  // Traza del RAG.
  trace: TraceEvent;
  // Paso del RAG básico para el modo clase.
  "rag-step": RagStep;
  // Resumen de CRAG.
  crag: CragSummary;
  // Paso intermedio de CRAG.
  step: CragStep;
  // Resumen de la investigación.
  research: ResearchSummary;
  // Fuente externa de la investigación.
  "research-source": ResearchSource;
  // Paso intermedio de la investigación.
  "research-step": ResearchStep;
};

// Mensaje completo de la aplicación: metadatos de la ejecución y estas partes de datos.
export type CourseUIMessage = UIMessage<RunMetadata, CourseDataParts>;
