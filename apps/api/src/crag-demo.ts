// GUÍA DE LECTURA · apps/api/src/crag-demo.ts
// Puertos de la demo de CRAG: cada guion (suficiente, parcial, descartado, ausente, error) produce
// búsquedas y evaluaciones fijas sobre el corpus del curso para enseñar el grafo sin llamar a un
// modelo. Una pregunta libre usa el índice léxico del corpus del chat (el del curso o el de la tienda).
// Guiones y su tipo.
import { DEMO_CRAG_SCENARIOS, type DemoScenarioId } from "@thepower-rag/contracts";
// Utilidades de CRAG y del embedding de la demo.
import {
  // Coseno, topes del grafo y embedding léxico de la demo.
  cosine,
  CRAG_BOUNDS,
  FIXTURE_EMBEDDING_MODEL,
  FIXTURE_MIN_SCORE,
  fixtureEmbed,
  // Normaliza consultas para detectar repeticiones.
  normalizeQuery,
  // Tipos de candidato, puertos, señal y fragmento.
  type CragChunk,
  type CragPorts,
  type CragSignal,
  type IndexedChunk,
} from "@thepower-rag/core";
// Corpus y perfil de la demo.
import { fixtureChunks, fixtureProfile } from "./fixture";

// Fragmento de S5 (LangGraph).
const S5 = "c3a59a406888b:s05-langgraph:00";
// Fragmento de S6 (observabilidad).
const S6 = "c3a59a406888b:s06-observabilidad:00";
// Fragmento de S16 (AWS), que no sirve para estas preguntas.
const S16 = "c3a59a406888b:s16-cloud-aws:00";

// Guion pedido explícitamente o el que coincide con la pregunta.
export function resolveDemoScenario(
  explicit: DemoScenarioId | undefined,
  question: string,
): DemoScenarioId | null {
  // Si se eligió un guion, se usa.
  if (explicit !== undefined) {
    // Guion elegido.
    return explicit;
  }
  // Guion cuya pregunta coincide exactamente.
  const match = DEMO_CRAG_SCENARIOS.find((item) => item.question === question.trim());
  // Su id o null.
  return match?.id ?? null;
}

// Convierte un fragmento de la demo en candidato de CRAG con una puntuación fija.
function scripted(chunk: IndexedChunk, score: number, profileId: string): CragChunk {
  // Candidato.
  return {
    // Datos del fragmento tal y como los espera el grafo.
    documentId: chunk.documentId,
    chunkId: chunk.chunkId,
    title: chunk.title,
    section: chunk.section,
    text: chunk.text,
    audience: chunk.audience,
    // Versión del corpus y perfil de la demo, para que el grafo compruebe que coinciden.
    corpusVersion: chunk.corpusVersion,
    profileId,
    // Puntuación fija del guion.
    score,
  };
}

// Busca un fragmento por id.
function byId(chunks: readonly IndexedChunk[], id: string, score: number): CragChunk {
  // Fragmento.
  const found = chunks.find((chunk) => chunk.chunkId === id);
  // No existe.
  if (found === undefined) {
    // Error del guion.
    throw new Error(`Falta el fragmento de prueba ${id}.`);
  }
  // Candidato con la puntuación dada (los guiones son del curso).
  return scripted(found, score, fixtureProfile().id);
}

// Evaluación con la forma que espera el validador.
function decision(
  chunks: readonly CragChunk[],
  status: "sufficient" | "partial" | "insufficient",
  reason: string,
  gaps: string[],
  usefulIds: string[],
): unknown {
  // Salida del evaluador de prueba.
  return {
    // Orden de los candidatos con su puntuación y un motivo que aclara que es un guion.
    ranking: chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      score: chunk.score ?? 0,
      reason: "Guion de prueba. No es un modelo.",
    })),
    // Estado (suficiente, parcial o insuficiente), motivo, lagunas e ids útiles.
    status,
    reason,
    gaps,
    usefulIds,
  };
}

// Respuesta de prueba con una cita por fragmento.
function fixtureAnswer(evidence: readonly CragChunk[]): string {
  // Línea con la cita y el texto recortado.
  const lines = evidence.map(
    (chunk) =>
      `Según [cite:${chunk.chunkId}] (${chunk.section}): ${chunk.text.replace(/\s+/g, " ").slice(0, 280)}`,
  );
  // Texto de la respuesta.
  return `Respuesta de prueba del grafo CRAG. El guion no mide calidad ni llama a un modelo.\n${lines.join("\n")}`;
}

// Crea los puertos de la demo para un guion.
export function createDemoCragPorts(input: {
  // Señal de cancelación.
  signal: CragSignal;
  // Guion, o null en pregunta libre.
  scenarioId: DemoScenarioId | null;
  // Fragmentos y perfil de la pregunta libre; sin valor, los del curso.
  library?: readonly IndexedChunk[];
  profileId?: string;
  // Reloj inyectable.
  now?: () => number;
}): CragPorts {
  // Corpus del curso, del que salen los guiones.
  const course = fixtureChunks();
  // Corpus de la pregunta libre.
  const library = input.library ?? course;
  // Su perfil.
  const profileId = input.profileId ?? fixtureProfile().id;
  // Guion.
  const scenario = input.scenarioId;
  // Puertos.
  return {
    measured: false,
    now: input.now ?? Date.now,
    signal: input.signal,
    // Comprueba o registra la reserva previa que permite continuar con una operación de pago.
    reserve: () => ({ ok: true }),
    // Recupera candidatos documentales dentro del ámbito de corpus y consulta del recorrido.
    async retrieve({ query, scope, attempt }) {
      // Suficiente: S5 a la primera.
      if (scenario === "sufficient-s5") {
        // S5.
        return { ok: true, providerCall: false, chunks: [byId(course, S5, 0.91)] };
      }
      // Parcial: S5 y después S5 con S6.
      if (scenario === "partial-s5-s6") {
        // Según el intento.
        return {
          ok: true,
          providerCall: false,
          chunks:
            attempt === 1
              ? [byId(course, S5, 0.8)]
              : [byId(course, S5, 0.4), byId(course, S6, 0.86)],
        };
      }
      // Descartado: S16 y después S6.
      if (scenario === "irrelevant-then-s6") {
        // Según el intento.
        return {
          ok: true,
          providerCall: false,
          chunks: attempt === 1 ? [byId(course, S16, 0.2)] : [byId(course, S6, 0.88)],
        };
      }
      // Dato ausente o error: S16.
      if (scenario === "missing-info" || scenario === "evaluator-error") {
        // S16.
        return { ok: true, providerCall: false, chunks: [byId(course, S16, 0.1)] };
      }
      // Pregunta libre: vector léxico de la consulta.
      const embedded = fixtureEmbed(query);
      // Fragmentos visibles ordenados por coseno.
      const chunks = library
        .filter(
          (chunk) =>
            chunk.corpusVersion === scope.corpusVersion &&
            (scope.audience === "program"
              ? chunk.audience === "program"
              : chunk.audience === "program" || chunk.audience === scope.audience),
        )
        .map((chunk) => scripted(chunk, cosine(embedded, chunk.vector), profileId))
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
        .slice(0, CRAG_BOUNDS.maxCandidates);
      // Candidatos.
      return { ok: true, providerCall: false, chunks };
    },
    // Ordena los fragmentos y evalúa si aportan evidencia suficiente para la pregunta.
    async rankAndAssess({ chunks }) {
      // Error provocado: ids inexistentes.
      if (scenario === "evaluator-error") {
        // Salida inválida.
        return {
          // providerCall: false indica que no hubo llamada de pago.
          ok: true,
          providerCall: false,
          // Salida cruda con un id inexistente: el validador del grafo debe rechazarla.
          raw: {
            // Una sola entrada con un id inventado.
            ranking: [
              {
                chunkId: "no-existe",
                score: 1,
                reason: "Id que no está en la búsqueda.",
              },
            ],
            // Dice «suficiente» con ese id como útil.
            status: "sufficient",
            reason: "Salida inválida de prueba.",
            gaps: [],
            usefulIds: ["no-existe"],
          },
        };
      }
      // Suficiente.
      if (scenario === "sufficient-s5") {
        // S5 basta.
        return {
          ok: true,
          providerCall: false,
          raw: decision(chunks, "sufficient", "La ficha de S5 describe estado y nodos.", [], [S5]),
        };
      }
      // Parcial.
      if (scenario === "partial-s5-s6") {
        // Ids de la búsqueda.
        const ids = chunks.map((chunk) => chunk.chunkId);
        // Con S6 ya es suficiente.
        if (ids.includes(S6)) {
          // Suficiente.
          return {
            // Suficiente: S5 y S6 cubren la pregunta.
            ok: true,
            providerCall: false,
            raw: decision(
              chunks,
              "sufficient",
              "S5 y S6 cubren estado y observabilidad.",
              [],
              [S5, S6],
            ),
          };
        }
        // Solo S5: parcial con laguna.
        return {
          // Parcial: conserva S5 y nombra la laguna para reformular.
          ok: true,
          providerCall: false,
          raw: decision(
            chunks,
            "partial",
            "S5 aporta el estado, falta la observabilidad.",
            ["Falta cómo observar la ejecución del agente."],
            [S5],
          ),
        };
      }
      // Descartado.
      if (scenario === "irrelevant-then-s6") {
        // Ids de la búsqueda.
        const ids = chunks.map((chunk) => chunk.chunkId);
        // S6 sin S16: suficiente.
        if (ids.includes(S6) && !ids.includes(S16)) {
          // Suficiente.
          return {
            // Suficiente tras la reformulación: S6 cubre lo que faltaba.
            ok: true,
            providerCall: false,
            raw: decision(
              chunks,
              "sufficient",
              "La ficha de S6 cubre la observabilidad.",
              [],
              [S6],
            ),
          };
        }
        // S16: insuficiente.
        return {
          // Insuficiente: se descarta el contexto de esta pasada.
          ok: true,
          providerCall: false,
          raw: decision(
            chunks,
            "insufficient",
            "Este fragmento no trata la observabilidad.",
            [],
            [],
          ),
        };
      }
      // Dato ausente.
      if (scenario === "missing-info") {
        // Insuficiente.
        return {
          ok: true,
          providerCall: false,
          raw: decision(chunks, "insufficient", "Ningún fragmento menciona esa beca.", [], []),
        };
      }
      // Pregunta libre: útiles los que superan el umbral léxico.
      const useful = chunks.filter(
        (chunk) => chunk.score !== null && chunk.score >= FIXTURE_MIN_SCORE,
      );
      // Ninguno.
      if (useful.length === 0) {
        // Insuficiente.
        return {
          // Pregunta libre sin fragmentos útiles: insuficiente.
          ok: true,
          providerCall: false,
          raw: decision(
            chunks,
            "insufficient",
            "Ningún fragmento supera el umbral lexical de prueba.",
            [],
            [],
          ),
        };
      }
      // Suficiente con los útiles.
      return {
        // Pregunta libre: los fragmentos que superan el umbral léxico son útiles (como mucho
        // maxRetained).
        ok: true,
        providerCall: false,
        raw: decision(
          chunks,
          "sufficient",
          "Supera el umbral lexical de la demostración. No es un evaluador.",
          [],
          useful.slice(0, CRAG_BOUNDS.maxRetained).map((chunk) => chunk.chunkId),
        ),
      };
    },
    // Propone otra consulta a partir de la pregunta y las carencias detectadas.
    async reformulate({ question, query, attempt }) {
      // Parcial: consulta sobre observabilidad.
      if (scenario === "partial-s5-s6") {
        // Nueva consulta.
        return {
          ok: true,
          providerCall: false,
          raw: { query: "observabilidad Langfuse y LangSmith de un agente" },
        };
      }
      // Descartado: consulta de la sesión de observabilidad.
      if (scenario === "irrelevant-then-s6") {
        // Nueva consulta.
        return {
          ok: true,
          providerCall: false,
          raw: { query: "sesión de observabilidad Langfuse LangSmith" },
        };
      }
      // Dato ausente: añade el intento.
      if (scenario === "missing-info") {
        // Nueva consulta.
        return {
          ok: true,
          providerCall: false,
          raw: { query: `${question} intento ${String(attempt + 1)}` },
        };
      }
      // Sufijo para preguntas libres.
      const suffix = "temario AI Engineer";
      // Si ya lo tiene, se repite (el validador la rechazará).
      if (normalizeQuery(query).includes(normalizeQuery(suffix))) {
        // Misma consulta.
        return { ok: true, raw: { query }, providerCall: false };
      }
      // Consulta con el sufijo.
      return { ok: true, raw: { query: `${query} ${suffix}` }, providerCall: false };
    },
    // Produce la respuesta final con los fragmentos que este recorrido ha seleccionado.
    async generate({ evidence }) {
      // Respuesta de prueba con citas.
      return {
        ok: true,
        providerCall: false,
        text: fixtureAnswer(evidence),
        usage: null,
        cost: null,
      };
    },
  };
}

// Etiqueta del embedding de la demo.
export const DEMO_EMBEDDING_LABEL = FIXTURE_EMBEDDING_MODEL;
