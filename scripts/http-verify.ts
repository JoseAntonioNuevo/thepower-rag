// GUÍA DE LECTURA · scripts/http-verify.ts
// Verificación por HTTP del runtime: envía cinco turnos (sin RAG, RAG, CRAG, aclarar y rechazar) al puente,
// reserva antes cada llamada y comprueba qué adaptadores se usaron de verdad.
// Clasificación del runtime y tipos.
import {
  classifyRuntime,
  type AdapterRecord,
  type AllowanceLedger,
  type RuntimeProvenance,
} from "@thepower-rag/core";
// Tipo del resultado del comando.
import type { CommandOutcome } from "./activation";
// fetch a 127.0.0.1.
import { loopbackFetch } from "./loopback-fetch";

// Turno de la verificación.
interface Turn {
  // Id.
  id: string;
  // Modo.
  mode: "sin-rag" | "rag" | "crag";
  // Audiencia.
  audience: "program" | "M/J";
  // Pregunta.
  text: string;
  // Llamadas de embeddings esperadas.
  embeddingCalls: number;
  // Llamadas generativas esperadas.
  generativeCalls: number;
  // Comprobación de la respuesta.
  expect: (body: string, status: number) => boolean;
}

// Los cinco turnos con lo que se espera de cada uno.
const TURNS: readonly Turn[] = [
  {
    id: "sin-rag",
    mode: "sin-rag",
    audience: "program",
    text: "¿Qué es un embedding?",
    embeddingCalls: 0,
    generativeCalls: 1,
    expect: (body) =>
      body.includes('"completion":"complete"') && body.includes('"type":"text-delta"'),
  },
  {
    id: "rag",
    mode: "rag",
    audience: "M/J",
    text: "¿Cuándo es la clase de RAG S10?",
    embeddingCalls: 1,
    generativeCalls: 1,
    expect: (body) => body.includes("2026-10-22") && !body.includes("2026-10-26"),
  },
  {
    id: "crag",
    mode: "crag",
    audience: "program",
    text: "¿Cómo modela LangGraph un agente con estado y nodos?",
    embeddingCalls: 1,
    generativeCalls: 2,
    expect: (body) => body.includes("s05-langgraph"),
  },
  {
    id: "clarify",
    mode: "crag",
    audience: "program",
    text: "¿Cuándo es la clase de RAG?",
    embeddingCalls: 0,
    generativeCalls: 0,
    expect: (body) => body.toLowerCase().includes("grupo"),
  },
  {
    id: "refuse",
    mode: "rag",
    audience: "program",
    text: "¿Qué beca interna del año 1991 cubre este programa?",
    embeddingCalls: 1,
    generativeCalls: 0,
    expect: (body) => body.includes("No hay contexto utilizable") && !body.includes("[cite:"),
  },
];

// Cuerpo JSON del chat para un turno.
function chatBody(turn: Turn): string {
  // Modo, audiencia y mensaje.
  return JSON.stringify({
    mode: turn.mode,
    audience: turn.audience,
    messages: [{ id: turn.id, role: "user", parts: [{ type: "text", text: turn.text }] }],
  });
}

// Crea la verificación con el origen y la ficha del puente.
export function createHttpVerifier(input: {
  // Origen.
  origin: string;
  // Ficha.
  token: string;
  // fetch alternativo.
  fetchImpl?: typeof fetch;
}): (allowance: AllowanceLedger) => Promise<CommandOutcome> {
  // fetch indicado o loopback.
  const fetchImpl = input.fetchImpl ?? loopbackFetch;
  // Función que verifica con una sesión de gasto.
  return async (allowance) => {
    // Resultados por turno.
    const turns: { id: string; ok: boolean; detail: string }[] = [];
    // Adaptadores usados.
    const used: AdapterRecord[] = [];
    // Cada turno.
    for (const turn of TURNS) {
      // Última reserva.
      let header: string | null = null;
      // Reserva los embeddings.
      for (let index = 0; index < turn.embeddingCalls; index += 1) {
        // Reserva.
        const reserved = allowance.reserve({ kind: "embedding" });
        // Sin reserva.
        if (!reserved.ok) {
          // Fallo.
          return {
            ok: false,
            summary: reserved.reason,
            receipt: { calls: 0, provenance: "unknown", live: null },
          };
        }
        // Guarda el id.
        header = reserved.id;
        // Cierra la reserva.
        allowance.settle(reserved.id, null);
      }
      // Reserva las generaciones.
      for (let index = 0; index < turn.generativeCalls; index += 1) {
        // Reserva.
        const reserved = allowance.reserve({ kind: "generation" });
        // Sin reserva.
        if (!reserved.ok) {
          // Fallo.
          return {
            ok: false,
            summary: reserved.reason,
            receipt: { calls: 0, provenance: "unknown", live: null },
          };
        }
        // Guarda el id.
        header = reserved.id;
        // Cierra.
        allowance.settle(reserved.id, null);
      }
      // Cabeceras.
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-thepower-bridge": input.token,
      };
      // Con reserva.
      if (header !== null) {
        // La envía.
        headers["x-thepower-reservation"] = header;
      }
      // Envía el turno.
      const response = await fetchImpl(`${input.origin}/api/chat`, {
        method: "POST",
        headers,
        body: chatBody(turn),
      });
      // Respuesta.
      const body = await response.text();
      // Adaptadores usados.
      const recorded = await fetchImpl(`${input.origin}/bridge/used`, {
        headers: { "x-thepower-bridge": input.token },
      });
      // Cuerpo.
      const usedBody = (await recorded.json()) as { adapters?: typeof used };
      // Los acumula.
      used.push(...(usedBody.adapters ?? []));
      // 200 y lo esperado.
      const ok = response.status === 200 && turn.expect(body, response.status);
      // Registra.
      turns.push({
        id: turn.id,
        ok,
        detail: ok ? "ok" : `estado ${String(response.status)} ${body.slice(0, 240)}`,
      });
      // Fallo.
      if (!ok) {
        // Para.
        break;
      }
    }
    // Error local sintético: JSON roto.
    const broken = await fetchImpl(`${input.origin}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-thepower-bridge": input.token,
      },
      body: "{",
    });
    // Debe dar 400.
    turns.push({
      id: "local-error",
      ok: broken.status === 400,
      detail: "error sintético local, no es evidencia del proveedor",
    });
    // Procedencia según los adaptadores.
    const classified = classifyRuntime(used);
    // Procedencia.
    const provenance: RuntimeProvenance | "unknown" = classified.provenance;
    // Llamadas generativas reservadas.
    const generativeCalls = allowance
      .snapshot()
      .reservations.filter((item) => item.kind === "generation").length;
    // Resultado y recibo.
    return {
      ok: turns.every((turn) => turn.ok) && provenance !== "unknown" && generativeCalls <= 4,
      summary: turns.every((turn) => turn.ok)
        ? "verificación por la ruta HTTP del runtime"
        : `verificación incompleta: ${turns
            .filter((turn) => !turn.ok)
            .map((turn) => `${turn.id} ${turn.detail}`)
            .join(" | ")}`,
      receipt: {
        provenance,
        live: classified.live,
        syntheticError: true,
        pricesSynthetic: provenance !== "remote-binding",
        measuredChargeUsd: null,
        generativeCalls,
        turns,
        adapters: used,
      },
    };
  };
}
