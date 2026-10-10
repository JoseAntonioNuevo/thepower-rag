import { describe, expect, it } from "vite-plus/test";
import type { AcceptedEvidence, CoverageEntry } from "./evidence";
import type { PlanItem } from "./plan";
import type { WebEvidence } from "./ports";
import { claimSupported, claimSupportVerdict, verifyReport } from "./report";

const HASH = `sha256:${"a".repeat(64)}`;

function web(text: string, subquestionIds: string[], sourceId = "web-check"): AcceptedEvidence {
  const item: WebEvidence = {
    kind: "web",
    sourceId,
    requestedUrl: "https://docs.langchain.com/langgraph/persistence",
    url: "https://docs.langchain.com/langgraph/persistence",
    domain: "docs.langchain.com",
    title: "Persistencia",
    text,
    retrievedAt: "2026-10-10T00:00:00.000Z",
    publishedAt: null,
    contentHash: HASH,
    fixture: true,
  };
  return {
    item,
    subquestionIds,
    excerpts: [text.slice(0, 180)],
    reason: "Página técnica admitida.",
    round: 1,
  };
}

const grade = "¿Qué nota mínima exige el profesor para aprobar el ejercicio de S12?";
const technical = "¿Para qué sirve un checkpointer en LangGraph?";
const page =
  "Un checkpointer de LangGraph guarda el estado del grafo en cada paso. Esta página no trata calificaciones ni requisitos de ningún curso.";

const subs: PlanItem[] = [
  { id: "q1", text: grade, kind: "course", external: false, query: null },
  { id: "q2", text: technical, kind: "technical", external: true, query: "langgraph checkpointer" },
];

function technicalOnly<T>(items: readonly T[]): T {
  const item = items[1];
  if (item === undefined) {
    throw new Error("falta la subpregunta técnica");
  }
  return item;
}

function coverage(q1: CoverageEntry["status"] = "uncovered"): CoverageEntry[] {
  return [
    {
      subquestionId: "q1",
      status: q1,
      gap: q1 === "covered" ? null : "El material del curso no documenta una nota mínima.",
      followUp: false,
      sourceIds: [],
    },
    {
      subquestionId: "q2",
      status: "covered",
      gap: null,
      followUp: false,
      sourceIds: ["web-check"],
    },
  ];
}

describe("comprobación de afirmaciones", () => {
  it("rechaza una negación invertida aunque el resto de las palabras coincida", () => {
    const evidence = ["La dimensión del índice no se puede cambiar después de crearlo."];
    expect(
      claimSupported("La dimensión del índice se puede cambiar después de crearlo.", evidence),
    ).toBe(false);
    expect(
      claimSupportVerdict("La dimensión del índice se puede cambiar después de crearlo.", evidence),
    ).toBe("polarity");
    expect(
      claimSupported("La dimensión del índice no se puede cambiar después de crearlo.", evidence),
    ).toBe(true);
  });

  it("rechaza una cifra que la evidencia no contiene", () => {
    const evidence = ["La dimensión del índice es 768 y la métrica es coseno."];
    expect(
      claimSupported("La dimensión del índice es 1024 y la métrica es coseno.", evidence),
    ).toBe(false);
    expect(
      claimSupportVerdict("La dimensión del índice es 1024 y la métrica es coseno.", evidence),
    ).toBe("number");
    expect(claimSupported("La dimensión del índice es 768 y la métrica es coseno.", evidence)).toBe(
      true,
    );
  });

  it("retira la respuesta directa que inventa una nota citada con una página técnica", () => {
    const accepted = web(page, ["q2"]);
    const report = verifyReport(
      {
        answer: {
          text: "El curso exige nota mínima 9 para el ejercicio con LangGraph checkpointer.",
          sourceIds: ["web-check"],
        },
        findings: [
          {
            subquestionId: "q2",
            text: "Un checkpointer de LangGraph guarda el estado del grafo en cada paso.",
            sourceIds: ["web-check"],
          },
        ],
        checks: [
          {
            text: "El curso exige nota mínima 9 para aprobar el ejercicio.",
            sourceIds: ["web-check"],
          },
        ],
        unresolved: [],
      },
      {
        subquestions: subs,
        coverage: coverage(),
        causes: { q1: "missing-evidence", q2: "evidence" },
        accepted: [accepted],
        contradictions: [],
        fixture: false,
        stopIsFailure: false,
      },
    );
    if (!report.ok) {
      throw new Error(report.reason);
    }
    expect(report.value.outcome).not.toBe("complete");
    expect(report.value.markdown).not.toContain("nota mínima 9");
    expect(report.value.dropped.map((item) => item.claim).join(" ")).toContain("nota mínima 9");
    expect(report.value.markdown).toContain("checkpointer de LangGraph guarda el estado");
  });

  it("una contradicción sin resolver impide un informe completo", () => {
    const accepted = web(
      "La dimensión del índice no se puede cambiar después de crearlo. El índice espera 1024 dimensiones.",
      ["q2"],
    );
    const report = verifyReport(
      {
        answer: {
          text: "La dimensión del índice no se puede cambiar después de crearlo.",
          sourceIds: ["web-check"],
        },
        findings: [
          {
            subquestionId: "q2",
            text: "La dimensión del índice no se puede cambiar después de crearlo.",
            sourceIds: ["web-check"],
          },
        ],
        checks: [],
        unresolved: [],
      },
      {
        subquestions: [technicalOnly(subs)],
        coverage: [technicalOnly(coverage())],
        causes: { q2: "evidence" },
        accepted: [accepted],
        contradictions: ["Una página niega el cambio de dimensión y otra lo afirma."],
        fixture: false,
        stopIsFailure: false,
      },
    );
    if (!report.ok) {
      throw new Error(report.reason);
    }
    expect(report.value.outcome).toBe("partial");
    expect(report.value.markdown).toContain("Contradicciones sin resolver");
    expect(report.value.markdown).toContain("No es un informe completo");
  });

  const excerpt = "Un checkpointer de LangGraph guarda el estado del grafo en cada paso.";
  const finding = {
    subquestionId: "q2",
    text: excerpt,
    sourceIds: ["web-check"],
  };

  function gradeReport(answer: string, checks: { text: string; sourceIds: string[] }[] = []) {
    return verifyReport(
      {
        answer: { text: answer, sourceIds: ["web-check"] },
        findings: [finding],
        checks,
        unresolved: [],
      },
      {
        subquestions: subs,
        coverage: coverage(),
        causes: { q1: "missing-evidence", q2: "evidence" },
        accepted: [web(excerpt, ["q2"])],
        contradictions: [],
        fixture: false,
        stopIsFailure: false,
      },
    );
  }

  it("no muestra «basta obtener un nueve» citado con la página del checkpointer", () => {
    const report = gradeReport("Para aprobar con LangGraph checkpointer basta obtener un nueve.");
    if (!report.ok) {
      throw new Error(report.reason);
    }
    expect(report.value.markdown).not.toContain("un nueve");
    expect(report.value.markdown).toContain("guarda el estado del grafo");
    expect(report.value.dropped.some((item) => item.claim.includes("un nueve"))).toBe(true);
    expect(report.value.outcome).not.toBe("complete");
  });

  it("separa la cláusula técnica de la cláusula que inventa el aprobado", () => {
    const report = gradeReport(`${excerpt} y para obtener el aprobado basta un nueve.`);
    if (!report.ok) {
      throw new Error(report.reason);
    }
    const direct = report.value.markdown.split("**Hallazgos")[0] ?? "";
    expect(direct).toContain("guarda el estado");
    expect(direct).not.toContain("nueve");
    expect(report.value.markdown).not.toContain("basta un nueve");
    expect(report.value.dropped.some((item) => item.claim.includes("nueve"))).toBe(true);
  });

  it("retira el añadido también cuando va en una comprobación práctica", () => {
    const report = gradeReport(excerpt, [
      {
        text: "Un checkpointer de LangGraph guarda el estado del grafo en cada paso y para aprobar basta un nueve.",
        sourceIds: ["web-check"],
      },
    ]);
    if (!report.ok) {
      throw new Error(report.reason);
    }
    expect(report.value.markdown).toContain("guarda el estado del grafo en cada paso");
    expect(report.value.markdown).not.toContain("basta un nueve");
    expect(report.value.dropped.some((item) => item.claim.includes("basta un nueve"))).toBe(true);
  });

  it("no deja pasar otra afirmación interna aunque no hable de notas", () => {
    const report = gradeReport(`${excerpt} y el profesor exige asistencia obligatoria.`);
    if (!report.ok) {
      throw new Error(report.reason);
    }
    const direct = report.value.markdown.split("**Hallazgos")[0] ?? "";
    expect(direct).toContain("guarda el estado");
    expect(direct).not.toContain("asistencia obligatoria");
    expect(report.value.markdown).not.toContain("asistencia obligatoria");
  });

  it("mantiene visible una respuesta técnica contenida en el extracto", () => {
    const report = gradeReport(excerpt);
    if (!report.ok) {
      throw new Error(report.reason);
    }
    expect(report.value.markdown).toContain(`**Respuesta directa.** ${excerpt}`);
    expect(report.value.dropped).toEqual([]);
    expect(report.value.outcome).toBe("partial");
  });

  function dimensionReport(answer: string, findingText: string) {
    const source = "El índice espera 1024 dimensiones y el modelo produce 768 dimensiones.";
    const technicalSub: PlanItem = {
      id: "q1",
      text: "Qué dimensiones esperan el índice y el modelo.",
      kind: "technical",
      external: true,
      query: "vectorize dimensions",
    };
    return verifyReport(
      {
        answer: { text: answer, sourceIds: ["web-dim"] },
        findings: [{ subquestionId: "q1", text: findingText, sourceIds: ["web-dim"] }],
        checks: [],
        unresolved: [],
      },
      {
        subquestions: [technicalSub],
        coverage: [
          {
            subquestionId: "q1",
            status: "covered",
            gap: null,
            followUp: false,
            sourceIds: ["web-dim"],
          },
        ],
        causes: { q1: "evidence" },
        accepted: [web(source, ["q1"], "web-dim")],
        contradictions: [],
        fixture: false,
        stopIsFailure: false,
      },
    );
  }

  it("no acepta el intercambio de 1024 y 768 entre el índice y el modelo", () => {
    const reversed = "El índice espera 768 dimensiones y el modelo produce 1024 dimensiones.";
    const report = dimensionReport(reversed, reversed);
    if (!report.ok) {
      throw new Error(report.reason);
    }
    expect(report.value.outcome).not.toBe("complete");
    expect(report.value.dropped.length).toBeGreaterThan(0);
    expect(report.value.markdown).not.toContain(reversed);
    expect(report.value.markdown).not.toContain("espera 768");
    expect(report.value.markdown).not.toContain("produce 1024");
  });

  it("no acepta intercambiar otras cifras entre dos sujetos", () => {
    const source = "El curso dura 6 horas y el ejercicio dura 9 horas.";
    const swapped = "El curso dura 9 horas y el ejercicio dura 6 horas.";
    const technicalSub: PlanItem = {
      id: "q1",
      text: "Cuánto duran el curso y el ejercicio.",
      kind: "technical",
      external: true,
      query: null,
    };
    const report = verifyReport(
      {
        answer: { text: swapped, sourceIds: ["web-hours"] },
        findings: [{ subquestionId: "q1", text: swapped, sourceIds: ["web-hours"] }],
        checks: [],
        unresolved: [],
      },
      {
        subquestions: [technicalSub],
        coverage: [
          {
            subquestionId: "q1",
            status: "covered",
            gap: null,
            followUp: false,
            sourceIds: ["web-hours"],
          },
        ],
        causes: { q1: "evidence" },
        accepted: [web(source, ["q1"], "web-hours")],
        contradictions: [],
        fixture: false,
        stopIsFailure: false,
      },
    );
    if (!report.ok) {
      throw new Error(report.reason);
    }
    expect(report.value.outcome).not.toBe("complete");
    expect(report.value.markdown).not.toContain("dura 9 horas");
    expect(report.value.markdown).not.toContain(swapped);
  });

  it("rechaza un cambio de orden que invierte quién guarda a quién", () => {
    const reversed = "El estado del grafo guarda un checkpointer de LangGraph.";
    const report = gradeReport(reversed);
    if (!report.ok) {
      throw new Error(report.reason);
    }
    expect(report.value.markdown).not.toContain("grafo guarda un checkpointer");
    expect(report.value.dropped.some((item) => item.claim.includes("grafo guarda"))).toBe(true);
    expect(report.value.markdown).toContain(excerpt);
  });

  it("mantiene el extracto original de las dimensiones", () => {
    const source = "El índice espera 1024 dimensiones y el modelo produce 768 dimensiones.";
    const report = dimensionReport(source, source);
    if (!report.ok) {
      throw new Error(report.reason);
    }
    expect(report.value.outcome).toBe("complete");
    expect(report.value.dropped).toEqual([]);
    expect(report.value.markdown).toContain(source);
    expect(report.value.markdown).toContain("espera 1024");
    expect(report.value.markdown).toContain("produce 768");
  });

  it("no muestra la versión afirmativa de una frase negada en el extracto", () => {
    const negative = "La dimensión del índice no se puede cambiar después de crearlo.";
    const positive = "La dimensión del índice se puede cambiar después de crearlo.";
    const technicalSub: PlanItem = {
      id: "q1",
      text: "Si la dimensión del índice se puede cambiar.",
      kind: "technical",
      external: true,
      query: null,
    };
    const accepted = web(negative, ["q1"]);
    const report = verifyReport(
      {
        answer: { text: positive, sourceIds: ["web-check"] },
        findings: [{ subquestionId: "q1", text: negative, sourceIds: ["web-check"] }],
        checks: [],
        unresolved: [],
      },
      {
        subquestions: [technicalSub],
        coverage: [
          {
            subquestionId: "q1",
            status: "covered",
            gap: null,
            followUp: false,
            sourceIds: ["web-check"],
          },
        ],
        causes: { q1: "evidence" },
        accepted: [accepted],
        contradictions: [],
        fixture: false,
        stopIsFailure: false,
      },
    );
    if (!report.ok) {
      throw new Error(report.reason);
    }
    expect(report.value.outcome).not.toBe("complete");
    expect(report.value.markdown).not.toContain(positive);
    expect(report.value.markdown).toContain(negative);
  });
});
