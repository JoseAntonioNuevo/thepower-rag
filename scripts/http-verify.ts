import {
  classifyRuntime,
  type AdapterRecord,
  type AllowanceLedger,
  type RuntimeProvenance,
} from "@thepower-rag/core";
import type { CommandOutcome } from "./activation";
import { loopbackFetch } from "./loopback-fetch";

interface Turn {
  id: string;
  mode: "sin-rag" | "rag" | "crag";
  audience: "program" | "M/J";
  text: string;
  embeddingCalls: number;
  generativeCalls: number;
  expect: (body: string, status: number) => boolean;
}

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

function chatBody(turn: Turn): string {
  return JSON.stringify({
    mode: turn.mode,
    audience: turn.audience,
    messages: [{ id: turn.id, role: "user", parts: [{ type: "text", text: turn.text }] }],
  });
}

export function createHttpVerifier(input: {
  origin: string;
  token: string;
  fetchImpl?: typeof fetch;
}): (allowance: AllowanceLedger) => Promise<CommandOutcome> {
  const fetchImpl = input.fetchImpl ?? loopbackFetch;
  return async (allowance) => {
    const turns: { id: string; ok: boolean; detail: string }[] = [];
    const used: AdapterRecord[] = [];
    for (const turn of TURNS) {
      let header: string | null = null;
      for (let index = 0; index < turn.embeddingCalls; index += 1) {
        const reserved = allowance.reserve({ kind: "embedding" });
        if (!reserved.ok) {
          return {
            ok: false,
            summary: reserved.reason,
            receipt: { calls: 0, provenance: "unknown", live: null },
          };
        }
        header = reserved.id;
        allowance.settle(reserved.id, null);
      }
      for (let index = 0; index < turn.generativeCalls; index += 1) {
        const reserved = allowance.reserve({ kind: "generation" });
        if (!reserved.ok) {
          return {
            ok: false,
            summary: reserved.reason,
            receipt: { calls: 0, provenance: "unknown", live: null },
          };
        }
        header = reserved.id;
        allowance.settle(reserved.id, null);
      }
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-thepower-bridge": input.token,
      };
      if (header !== null) {
        headers["x-thepower-reservation"] = header;
      }
      const response = await fetchImpl(`${input.origin}/api/chat`, {
        method: "POST",
        headers,
        body: chatBody(turn),
      });
      const body = await response.text();
      const recorded = await fetchImpl(`${input.origin}/bridge/used`, {
        headers: { "x-thepower-bridge": input.token },
      });
      const usedBody = (await recorded.json()) as { adapters?: typeof used };
      used.push(...(usedBody.adapters ?? []));
      const ok = response.status === 200 && turn.expect(body, response.status);
      turns.push({
        id: turn.id,
        ok,
        detail: ok ? "ok" : `estado ${String(response.status)} ${body.slice(0, 240)}`,
      });
      if (!ok) {
        break;
      }
    }
    const broken = await fetchImpl(`${input.origin}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-thepower-bridge": input.token,
      },
      body: "{",
    });
    turns.push({
      id: "local-error",
      ok: broken.status === 400,
      detail: "error sintético local, no es evidencia del proveedor",
    });
    const classified = classifyRuntime(used);
    const provenance: RuntimeProvenance | "unknown" = classified.provenance;
    const generativeCalls = allowance
      .snapshot()
      .reservations.filter((item) => item.kind === "generation").length;
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
