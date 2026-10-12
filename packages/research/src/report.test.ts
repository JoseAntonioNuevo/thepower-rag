// GUÍA DE LECTURA · packages/research/src/report.test.ts
// Pruebas de la verificación del informe: negaciones invertidas, cifras cambiadas o intercambiadas,
// datos internos inventados con fuentes técnicas, cláusulas añadidas, orden invertido y contradicciones.
// Utilidades de prueba.
import { describe, expect, it } from "vite-plus/test";
// Tipos de evidencia y cobertura.
import type { AcceptedEvidence, CoverageEntry } from "./evidence";
// Tipo de subpregunta.
import type { PlanItem } from "./plan";
// Tipo de evidencia web.
import type { WebEvidence } from "./ports";
// Funciones de verificación.
import { claimSupported, claimSupportVerdict, verifyReport } from "./report";

// Hash de contenido de prueba.
const HASH = `sha256:${"a".repeat(64)}`;

// Evidencia web aceptada de prueba con un texto y sus subpreguntas.
function web(text: string, subquestionIds: string[], sourceId = "web-check"): AcceptedEvidence {
  // Página de prueba.
  const item: WebEvidence = {
    // Página web admitida con URL, dominio y título fijos.
    kind: "web",
    sourceId,
    requestedUrl: "https://docs.langchain.com/langgraph/persistence",
    url: "https://docs.langchain.com/langgraph/persistence",
    domain: "docs.langchain.com",
    title: "Persistencia",
    // Texto que pasa el test, fechas y hash fijo.
    text,
    retrievedAt: "2026-10-10T00:00:00.000Z",
    publishedAt: null,
    contentHash: HASH,
    fixture: true,
  };
  // Evidencia aceptada con un extracto literal del texto.
  return {
    item,
    subquestionIds,
    excerpts: [text.slice(0, 180)],
    reason: "Página técnica admitida.",
    round: 1,
  };
}

// Pregunta interna del curso (nota mínima) que la web no puede responder.
const grade = "¿Qué nota mínima exige el profesor para aprobar el ejercicio de S12?";
// Pregunta técnica.
const technical = "¿Para qué sirve un checkpointer en LangGraph?";
// Página técnica que no habla de notas.
const page =
  "Un checkpointer de LangGraph guarda el estado del grafo en cada paso. Esta página no trata calificaciones ni requisitos de ningún curso.";

// Plan con una subpregunta del curso y otra técnica.
const subs: PlanItem[] = [
  { id: "q1", text: grade, kind: "course", external: false, query: null },
  { id: "q2", text: technical, kind: "technical", external: true, query: "langgraph checkpointer" },
];

// Devuelve el segundo elemento (la parte técnica) o falla si no existe.
function technicalOnly<T>(items: readonly T[]): T {
  // Segundo elemento.
  const item = items[1];
  // No existe.
  if (item === undefined) {
    // Error de la prueba.
    throw new Error("falta la subpregunta técnica");
  }
  // Elemento técnico.
  return item;
}

// Cobertura de prueba: q1 con el estado pedido y q2 cubierta.
function coverage(q1: CoverageEntry["status"] = "uncovered"): CoverageEntry[] {
  // Lista de dos coberturas.
  return [
    // q1: dato interno; por defecto sin cubrir y con su laguna.
    {
      subquestionId: "q1",
      status: q1,
      gap: q1 === "covered" ? null : "El material del curso no documenta una nota mínima.",
      followUp: false,
      sourceIds: [],
    },
    // q2: técnica, cubierta por la página web.
    {
      subquestionId: "q2",
      status: "covered",
      gap: null,
      followUp: false,
      sourceIds: ["web-check"],
    },
  ];
}

// Grupo de pruebas de la comprobación de afirmaciones.
describe("comprobación de afirmaciones", () => {
  // Quitar el «no» cambia el sentido aunque coincidan las palabras.
  it("rechaza una negación invertida aunque el resto de las palabras coincida", () => {
    // Evidencia con negación.
    const evidence = ["La dimensión del índice no se puede cambiar después de crearlo."];
    // Sin la negación: no respaldada.
    expect(
      claimSupported("La dimensión del índice se puede cambiar después de crearlo.", evidence),
    ).toBe(false);
    // Veredicto de polaridad.
    expect(
      claimSupportVerdict("La dimensión del índice se puede cambiar después de crearlo.", evidence),
    ).toBe("polarity");
    // Con la negación: respaldada.
    expect(
      claimSupported("La dimensión del índice no se puede cambiar después de crearlo.", evidence),
    ).toBe(true);
  });

  // Una cifra que no está en la evidencia se rechaza.
  it("rechaza una cifra que la evidencia no contiene", () => {
    // Evidencia con 768.
    const evidence = ["La dimensión del índice es 768 y la métrica es coseno."];
    // Con 1024: no respaldada.
    expect(
      claimSupported("La dimensión del índice es 1024 y la métrica es coseno.", evidence),
    ).toBe(false);
    // Veredicto de cifra.
    expect(
      claimSupportVerdict("La dimensión del índice es 1024 y la métrica es coseno.", evidence),
    ).toBe("number");
    // Con 768: respaldada.
    expect(claimSupported("La dimensión del índice es 768 y la métrica es coseno.", evidence)).toBe(
      true,
    );
  });

  // Se retira una nota inventada aunque cite una página técnica.
  it("retira la respuesta directa que inventa una nota citada con una página técnica", () => {
    // Página aceptada solo para la pregunta técnica.
    const accepted = web(page, ["q2"]);
    // Informe con una respuesta inventada y un hallazgo válido.
    const report = verifyReport(
      // Borrador del modelo.
      {
        // Respuesta que inventa una nota mínima y cita la página técnica.
        answer: {
          text: "El curso exige nota mínima 9 para el ejercicio con LangGraph checkpointer.",
          sourceIds: ["web-check"],
        },
        // Hallazgo válido: reproduce la página.
        findings: [
          {
            subquestionId: "q2",
            text: "Un checkpointer de LangGraph guarda el estado del grafo en cada paso.",
            sourceIds: ["web-check"],
          },
        ],
        // Comprobación que repite la invención.
        checks: [
          {
            text: "El curso exige nota mínima 9 para aprobar el ejercicio.",
            sourceIds: ["web-check"],
          },
        ],
        unresolved: [],
      },
      // Contexto de la verificación: subpreguntas, cobertura, causas, evidencia y contradicciones.
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
    // La verificación debe aceptar la forma del informe.
    if (!report.ok) {
      // Si no, la prueba falla con el motivo.
      throw new Error(report.reason);
    }
    // No es completo.
    expect(report.value.outcome).not.toBe("complete");
    // La nota inventada no aparece.
    expect(report.value.markdown).not.toContain("nota mínima 9");
    // Aparece entre las retiradas.
    expect(report.value.dropped.map((item) => item.claim).join(" ")).toContain("nota mínima 9");
    // El hallazgo técnico se conserva.
    expect(report.value.markdown).toContain("checkpointer de LangGraph guarda el estado");
  });

  // Una contradicción impide un informe completo.
  it("una contradicción sin resolver impide un informe completo", () => {
    // Evidencia aceptada.
    const accepted = web(
      "La dimensión del índice no se puede cambiar después de crearlo. El índice espera 1024 dimensiones.",
      ["q2"],
    );
    // Informe con la contradicción registrada.
    const report = verifyReport(
      // Borrador que afirma algo que las fuentes contradicen.
      {
        // Respuesta y hallazgo con la misma afirmación.
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
        // Sin comprobaciones ni pendientes.
        checks: [],
        unresolved: [],
      },
      // Contexto con la contradicción registrada.
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
    // Forma válida.
    if (!report.ok) {
      // Si no, falla.
      throw new Error(report.reason);
    }
    // Parcial.
    expect(report.value.outcome).toBe("partial");
    // Con la sección de contradicciones.
    expect(report.value.markdown).toContain("Contradicciones sin resolver");
    // Con el aviso de no completo.
    expect(report.value.markdown).toContain("No es un informe completo");
  });

  // Extracto de la página técnica.
  const excerpt = "Un checkpointer de LangGraph guarda el estado del grafo en cada paso.";
  // Hallazgo válido que lo repite.
  const finding = {
    subquestionId: "q2",
    text: excerpt,
    sourceIds: ["web-check"],
  };

  // Construye un informe con una respuesta y comprobaciones de prueba.
  function gradeReport(answer: string, checks: { text: string; sourceIds: string[] }[] = []) {
    // Verifica con la página técnica.
    return verifyReport(
      // Borrador: respuesta a probar, hallazgo técnico y comprobaciones opcionales.
      {
        answer: { text: answer, sourceIds: ["web-check"] },
        findings: [finding],
        checks,
        unresolved: [],
      },
      // Contexto con la página técnica admitida.
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

  // Una nota inventada citada con la página técnica no se muestra.
  it("no muestra «basta obtener un nueve» citado con la página del checkpointer", () => {
    // Informe con la nota inventada.
    const report = gradeReport("Para aprobar con LangGraph checkpointer basta obtener un nueve.");
    // Forma válida.
    if (!report.ok) {
      // Si no, falla.
      throw new Error(report.reason);
    }
    // No aparece la nota.
    expect(report.value.markdown).not.toContain("un nueve");
    // El hallazgo técnico sí.
    expect(report.value.markdown).toContain("guarda el estado del grafo");
    // La nota se retiró.
    expect(report.value.dropped.some((item) => item.claim.includes("un nueve"))).toBe(true);
    // No es completo.
    expect(report.value.outcome).not.toBe("complete");
  });

  // Se separa la cláusula técnica de la inventada.
  it("separa la cláusula técnica de la cláusula que inventa el aprobado", () => {
    // Respuesta con las dos cláusulas unidas por «y».
    const report = gradeReport(`${excerpt} y para obtener el aprobado basta un nueve.`);
    // Forma válida.
    if (!report.ok) {
      // Si no, falla.
      throw new Error(report.reason);
    }
    // Parte de la respuesta directa.
    const direct = report.value.markdown.split("**Hallazgos")[0] ?? "";
    // Conserva la parte técnica.
    expect(direct).toContain("guarda el estado");
    // Sin la parte inventada.
    expect(direct).not.toContain("nueve");
    // Tampoco en el resto.
    expect(report.value.markdown).not.toContain("basta un nueve");
    // La parte inventada se retiró.
    expect(report.value.dropped.some((item) => item.claim.includes("nueve"))).toBe(true);
  });

  // También se retira el añadido en una comprobación.
  it("retira el añadido también cuando va en una comprobación práctica", () => {
    // Comprobación con un añadido.
    const report = gradeReport(excerpt, [
      {
        text: "Un checkpointer de LangGraph guarda el estado del grafo en cada paso y para aprobar basta un nueve.",
        sourceIds: ["web-check"],
      },
    ]);
    // Forma válida.
    if (!report.ok) {
      // Si no, falla.
      throw new Error(report.reason);
    }
    // Conserva la parte respaldada.
    expect(report.value.markdown).toContain("guarda el estado del grafo en cada paso");
    // Sin el añadido.
    expect(report.value.markdown).not.toContain("basta un nueve");
    // El añadido se retiró.
    expect(report.value.dropped.some((item) => item.claim.includes("basta un nueve"))).toBe(true);
  });

  // Otra afirmación interna inventada también se retira.
  it("no deja pasar otra afirmación interna aunque no hable de notas", () => {
    // Respuesta con un requisito inventado.
    const report = gradeReport(`${excerpt} y el profesor exige asistencia obligatoria.`);
    // Forma válida.
    if (!report.ok) {
      // Si no, falla.
      throw new Error(report.reason);
    }
    // Parte de la respuesta directa.
    const direct = report.value.markdown.split("**Hallazgos")[0] ?? "";
    // Conserva la parte técnica.
    expect(direct).toContain("guarda el estado");
    // Sin el requisito.
    expect(direct).not.toContain("asistencia obligatoria");
    // Tampoco en el resto.
    expect(report.value.markdown).not.toContain("asistencia obligatoria");
  });

  // Una respuesta técnica literal se muestra.
  it("mantiene visible una respuesta técnica contenida en el extracto", () => {
    // Respuesta igual al extracto.
    const report = gradeReport(excerpt);
    // Forma válida.
    if (!report.ok) {
      // Si no, falla.
      throw new Error(report.reason);
    }
    // Se muestra como respuesta directa.
    expect(report.value.markdown).toContain(`**Respuesta directa.** ${excerpt}`);
    // Nada retirado.
    expect(report.value.dropped).toEqual([]);
    // Parcial: q1 sigue sin cubrir.
    expect(report.value.outcome).toBe("partial");
  });

  // Informe de prueba sobre dimensiones de índice y modelo.
  function dimensionReport(answer: string, findingText: string) {
    // Extracto con las dos cifras.
    const source = "El índice espera 1024 dimensiones y el modelo produce 768 dimensiones.";
    // Subpregunta técnica.
    const technicalSub: PlanItem = {
      id: "q1",
      text: "Qué dimensiones esperan el índice y el modelo.",
      kind: "technical",
      external: true,
      query: "vectorize dimensions",
    };
    // Verifica con ese extracto.
    return verifyReport(
      // Borrador con la respuesta y el hallazgo a probar.
      {
        answer: { text: answer, sourceIds: ["web-dim"] },
        findings: [{ subquestionId: "q1", text: findingText, sourceIds: ["web-dim"] }],
        checks: [],
        unresolved: [],
      },
      // Contexto: una subpregunta técnica cubierta por «web-dim».
      {
        // Una subpregunta técnica.
        subquestions: [technicalSub],
        // Cubierta por la fuente.
        coverage: [
          {
            subquestionId: "q1",
            status: "covered",
            gap: null,
            followUp: false,
            sourceIds: ["web-dim"],
          },
        ],
        // Causa, evidencia admitida y sin contradicciones.
        causes: { q1: "evidence" },
        accepted: [web(source, ["q1"], "web-dim")],
        contradictions: [],
        fixture: false,
        stopIsFailure: false,
      },
    );
  }

  // Intercambiar 1024 y 768 entre índice y modelo se rechaza.
  it("no acepta el intercambio de 1024 y 768 entre el índice y el modelo", () => {
    // Frase con las cifras cambiadas de sitio.
    const reversed = "El índice espera 768 dimensiones y el modelo produce 1024 dimensiones.";
    // Informe con esa frase.
    const report = dimensionReport(reversed, reversed);
    // Forma válida.
    if (!report.ok) {
      // Si no, falla.
      throw new Error(report.reason);
    }
    // No es completo.
    expect(report.value.outcome).not.toBe("complete");
    // Hay afirmaciones retiradas.
    expect(report.value.dropped.length).toBeGreaterThan(0);
    // La frase no aparece.
    expect(report.value.markdown).not.toContain(reversed);
    // Ni «espera 768».
    expect(report.value.markdown).not.toContain("espera 768");
    // Ni «produce 1024».
    expect(report.value.markdown).not.toContain("produce 1024");
  });

  // Intercambiar otras cifras entre sujetos también se rechaza.
  it("no acepta intercambiar otras cifras entre dos sujetos", () => {
    // Extracto con 6 y 9 horas.
    const source = "El curso dura 6 horas y el ejercicio dura 9 horas.";
    // Frase con las cifras intercambiadas.
    const swapped = "El curso dura 9 horas y el ejercicio dura 6 horas.";
    // Subpregunta técnica.
    const technicalSub: PlanItem = {
      id: "q1",
      text: "Cuánto duran el curso y el ejercicio.",
      kind: "technical",
      external: true,
      query: null,
    };
    // Verifica la frase intercambiada.
    const report = verifyReport(
      // Borrador con las cifras intercambiadas.
      {
        answer: { text: swapped, sourceIds: ["web-hours"] },
        findings: [{ subquestionId: "q1", text: swapped, sourceIds: ["web-hours"] }],
        checks: [],
        unresolved: [],
      },
      // Contexto con la fuente original de esas cifras.
      {
        // Una subpregunta técnica.
        subquestions: [technicalSub],
        // Cubierta por la fuente de las cifras.
        coverage: [
          {
            subquestionId: "q1",
            status: "covered",
            gap: null,
            followUp: false,
            sourceIds: ["web-hours"],
          },
        ],
        // Causa, evidencia y sin contradicciones.
        causes: { q1: "evidence" },
        accepted: [web(source, ["q1"], "web-hours")],
        contradictions: [],
        fixture: false,
        stopIsFailure: false,
      },
    );
    // Forma válida.
    if (!report.ok) {
      // Si no, falla.
      throw new Error(report.reason);
    }
    // No es completo.
    expect(report.value.outcome).not.toBe("complete");
    // No aparece la cifra cambiada.
    expect(report.value.markdown).not.toContain("dura 9 horas");
    // Ni la frase.
    expect(report.value.markdown).not.toContain(swapped);
  });

  // Invertir quién hace qué se rechaza aunque las palabras coincidan.
  it("rechaza un cambio de orden que invierte quién guarda a quién", () => {
    // Frase con el orden invertido.
    const reversed = "El estado del grafo guarda un checkpointer de LangGraph.";
    // Informe con esa frase.
    const report = gradeReport(reversed);
    // Forma válida.
    if (!report.ok) {
      // Si no, falla.
      throw new Error(report.reason);
    }
    // No aparece.
    expect(report.value.markdown).not.toContain("grafo guarda un checkpointer");
    // Se retiró.
    expect(report.value.dropped.some((item) => item.claim.includes("grafo guarda"))).toBe(true);
    // El extracto correcto sí aparece.
    expect(report.value.markdown).toContain(excerpt);
  });

  // El extracto original de las dimensiones se conserva entero.
  it("mantiene el extracto original de las dimensiones", () => {
    // Extracto.
    const source = "El índice espera 1024 dimensiones y el modelo produce 768 dimensiones.";
    // Informe que lo repite.
    const report = dimensionReport(source, source);
    // Forma válida.
    if (!report.ok) {
      // Si no, falla.
      throw new Error(report.reason);
    }
    // Completo.
    expect(report.value.outcome).toBe("complete");
    // Nada retirado.
    expect(report.value.dropped).toEqual([]);
    // Incluye el extracto.
    expect(report.value.markdown).toContain(source);
    // Con «espera 1024».
    expect(report.value.markdown).toContain("espera 1024");
    // Y «produce 768».
    expect(report.value.markdown).toContain("produce 768");
  });

  // La versión afirmativa de una frase negada no se muestra.
  it("no muestra la versión afirmativa de una frase negada en el extracto", () => {
    // Frase negada del extracto.
    const negative = "La dimensión del índice no se puede cambiar después de crearlo.";
    // Versión afirmativa.
    const positive = "La dimensión del índice se puede cambiar después de crearlo.";
    // Subpregunta técnica.
    const technicalSub: PlanItem = {
      id: "q1",
      text: "Si la dimensión del índice se puede cambiar.",
      kind: "technical",
      external: true,
      query: null,
    };
    // Evidencia con la frase negada.
    const accepted = web(negative, ["q1"]);
    // Informe con la afirmativa como respuesta.
    const report = verifyReport(
      // Borrador: respuesta positiva y hallazgo negativo de la misma frase.
      {
        answer: { text: positive, sourceIds: ["web-check"] },
        findings: [{ subquestionId: "q1", text: negative, sourceIds: ["web-check"] }],
        checks: [],
        unresolved: [],
      },
      // Contexto con la página admitida.
      {
        // Una subpregunta técnica.
        subquestions: [technicalSub],
        // Cubierta por la página.
        coverage: [
          {
            subquestionId: "q1",
            status: "covered",
            gap: null,
            followUp: false,
            sourceIds: ["web-check"],
          },
        ],
        // Causa, evidencia y sin contradicciones.
        causes: { q1: "evidence" },
        accepted: [accepted],
        contradictions: [],
        fixture: false,
        stopIsFailure: false,
      },
    );
    // Forma válida.
    if (!report.ok) {
      // Si no, falla.
      throw new Error(report.reason);
    }
    // No es completo.
    expect(report.value.outcome).not.toBe("complete");
    // No aparece la afirmativa.
    expect(report.value.markdown).not.toContain(positive);
    // Aparece la negada.
    expect(report.value.markdown).toContain(negative);
  });
});
