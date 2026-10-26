// GUÍA DE LECTURA · packages/research/src/report.test.ts
// Pruebas de la verificación del informe: negaciones invertidas, cifras cambiadas o intercambiadas,
// datos internos inventados con fuentes externas, cláusulas añadidas, orden invertido y contradicciones.
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
    requestedUrl: "https://europa.eu/youreurope/citizens/consumers/shopping/returns/index_es.htm",
    url: "https://europa.eu/youreurope/citizens/consumers/shopping/returns/index_es.htm",
    domain: "europa.eu",
    title: "Devoluciones",
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
    reason: "Página externa admitida.",
    round: 1,
  };
}

// Pregunta interna de la tienda (descuento para estudiantes) que la web no puede responder.
const grade = "¿Qué descuento hace ThePower Shop a los estudiantes?";
// Pregunta externa.
const externalQuestion = "¿Quién devuelve el dinero de una devolución?";
// Página externa que no habla de descuentos.
const page =
  "El vendedor reembolsa al comprador cuando valida la devolución. Esta página no trata descuentos ni cupones de ninguna tienda.";

// Plan con una subpregunta de la tienda y otra externa.
const subs: PlanItem[] = [
  { id: "q1", text: grade, kind: "store", external: false, query: null },
  {
    id: "q2",
    text: externalQuestion,
    kind: "external",
    external: true,
    query: "reembolso devolución vendedor",
  },
];

// Devuelve el segundo elemento (la parte externa) o falla si no existe.
function externalOnly<T>(items: readonly T[]): T {
  // Segundo elemento.
  const item = items[1];
  // No existe.
  if (item === undefined) {
    // Error de la prueba.
    throw new Error("falta la subpregunta externa");
  }
  // Elemento externo.
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
      gap: q1 === "covered" ? null : "Las políticas no documentan un descuento para estudiantes.",
      followUp: false,
      sourceIds: [],
    },
    // q2: externa, cubierta por la página web.
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
    const evidence = ["Los auriculares intraauditivos no se pueden devolver después de abrirlos."];
    // Sin la negación: no respaldada.
    expect(
      claimSupported(
        "Los auriculares intraauditivos se pueden devolver después de abrirlos.",
        evidence,
      ),
    ).toBe(false);
    // Veredicto de polaridad.
    expect(
      claimSupportVerdict(
        "Los auriculares intraauditivos se pueden devolver después de abrirlos.",
        evidence,
      ),
    ).toBe("polarity");
    // Con la negación: respaldada.
    expect(
      claimSupported(
        "Los auriculares intraauditivos no se pueden devolver después de abrirlos.",
        evidence,
      ),
    ).toBe(true);
  });

  // Una cifra que no está en la evidencia se rechaza.
  it("rechaza una cifra que la evidencia no contiene", () => {
    // Evidencia con 30 días.
    const evidence = ["El plazo de devolución es de 30 días y el reembolso usa el mismo método."];
    // Con 14 días: no respaldada.
    expect(
      claimSupported(
        "El plazo de devolución es de 14 días y el reembolso usa el mismo método.",
        evidence,
      ),
    ).toBe(false);
    // Veredicto de cifra.
    expect(
      claimSupportVerdict(
        "El plazo de devolución es de 14 días y el reembolso usa el mismo método.",
        evidence,
      ),
    ).toBe("number");
    // Con 30 días: respaldada.
    expect(
      claimSupported(
        "El plazo de devolución es de 30 días y el reembolso usa el mismo método.",
        evidence,
      ),
    ).toBe(true);
  });

  // Se retira un cupón inventado aunque cite una página externa.
  it("retira la respuesta directa que inventa un cupón citado con una página externa", () => {
    // Página aceptada solo para la pregunta externa.
    const accepted = web(page, ["q2"]);
    // Informe con una respuesta inventada y un hallazgo válido.
    const report = verifyReport(
      // Borrador del modelo.
      {
        // Respuesta que inventa un cupón y cita la página externa.
        answer: {
          text: "ThePower Shop da un cupón del 20 % a los estudiantes que devuelven un pedido.",
          sourceIds: ["web-check"],
        },
        // Hallazgo válido: reproduce la página.
        findings: [
          {
            subquestionId: "q2",
            text: "El vendedor reembolsa al comprador cuando valida la devolución.",
            sourceIds: ["web-check"],
          },
        ],
        // Comprobación que repite la invención.
        checks: [
          {
            text: "ThePower Shop da un cupón del 20 % a los estudiantes.",
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
    // El cupón inventado no aparece.
    expect(report.value.markdown).not.toContain("cupón del 20 %");
    // Aparece entre las retiradas.
    expect(report.value.dropped.map((item) => item.claim).join(" ")).toContain("cupón del 20 %");
    // El hallazgo externo se conserva.
    expect(report.value.markdown).toContain("reembolsa al comprador");
  });

  // Una contradicción impide un informe completo.
  it("una contradicción sin resolver impide un informe completo", () => {
    // Evidencia aceptada.
    const accepted = web(
      "Los auriculares intraauditivos no se pueden devolver después de abrirlos. La garantía legal dura 3 años.",
      ["q2"],
    );
    // Informe con la contradicción registrada.
    const report = verifyReport(
      // Borrador que afirma algo que las fuentes contradicen.
      {
        // Respuesta y hallazgo con la misma afirmación.
        answer: {
          text: "Los auriculares intraauditivos no se pueden devolver después de abrirlos.",
          sourceIds: ["web-check"],
        },
        findings: [
          {
            subquestionId: "q2",
            text: "Los auriculares intraauditivos no se pueden devolver después de abrirlos.",
            sourceIds: ["web-check"],
          },
        ],
        // Sin comprobaciones ni pendientes.
        checks: [],
        unresolved: [],
      },
      // Contexto con la contradicción registrada.
      {
        subquestions: [externalOnly(subs)],
        coverage: [externalOnly(coverage())],
        causes: { q2: "evidence" },
        accepted: [accepted],
        contradictions: ["Una página niega la devolución y otra la admite."],
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

  // Extracto de la página externa.
  const excerpt = "El vendedor reembolsa al comprador cuando valida la devolución.";
  // Hallazgo válido que lo repite.
  const finding = {
    subquestionId: "q2",
    text: excerpt,
    sourceIds: ["web-check"],
  };

  // Construye un informe con una respuesta y comprobaciones de prueba.
  function gradeReport(answer: string, checks: { text: string; sourceIds: string[] }[] = []) {
    // Verifica con la página externa.
    return verifyReport(
      // Borrador: respuesta a probar, hallazgo externo y comprobaciones opcionales.
      {
        answer: { text: answer, sourceIds: ["web-check"] },
        findings: [finding],
        checks,
        unresolved: [],
      },
      // Contexto con la página externa admitida.
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

  // Un cupón inventado citado con la página externa no se muestra.
  it("no muestra un cupón inventado citado con la página del reembolso", () => {
    // Informe con el cupón inventado.
    const report = gradeReport("Para los estudiantes basta pedir un cupón del 20 %.");
    // Forma válida.
    if (!report.ok) {
      // Si no, falla.
      throw new Error(report.reason);
    }
    // No aparece el cupón.
    expect(report.value.markdown).not.toContain("cupón del 20 %");
    // El hallazgo externo sí.
    expect(report.value.markdown).toContain("reembolsa al comprador");
    // El cupón se retiró.
    expect(report.value.dropped.some((item) => item.claim.includes("cupón del 20 %"))).toBe(true);
    // No es completo.
    expect(report.value.outcome).not.toBe("complete");
  });

  // Se separa la cláusula respaldada de la inventada.
  it("separa la cláusula respaldada de la cláusula que inventa un cupón", () => {
    // Respuesta con las dos cláusulas unidas por «y».
    const report = gradeReport(`${excerpt} y los estudiantes reciben un cupón del 20 %.`);
    // Forma válida.
    if (!report.ok) {
      // Si no, falla.
      throw new Error(report.reason);
    }
    // Parte de la respuesta directa.
    const direct = report.value.markdown.split("**Hallazgos")[0] ?? "";
    // Conserva la parte respaldada.
    expect(direct).toContain("reembolsa al comprador");
    // Sin la parte inventada.
    expect(direct).not.toContain("cupón");
    // Tampoco en el resto.
    expect(report.value.markdown).not.toContain("cupón del 20 %");
    // La parte inventada se retiró.
    expect(report.value.dropped.some((item) => item.claim.includes("cupón"))).toBe(true);
  });

  // También se retira el añadido en una comprobación.
  it("retira el añadido también cuando va en una comprobación práctica", () => {
    // Comprobación con un añadido.
    const report = gradeReport(excerpt, [
      {
        text: "El vendedor reembolsa al comprador cuando valida la devolución y los estudiantes reciben un cupón del 20 %.",
        sourceIds: ["web-check"],
      },
    ]);
    // Forma válida.
    if (!report.ok) {
      // Si no, falla.
      throw new Error(report.reason);
    }
    // Conserva la parte respaldada.
    expect(report.value.markdown).toContain("reembolsa al comprador cuando valida la devolución");
    // Sin el añadido.
    expect(report.value.markdown).not.toContain("cupón del 20 %");
    // El añadido se retiró.
    expect(report.value.dropped.some((item) => item.claim.includes("cupón del 20 %"))).toBe(true);
  });

  // Otra afirmación interna inventada también se retira.
  it("no deja pasar otra afirmación interna aunque no hable de cupones", () => {
    // Respuesta con un requisito inventado.
    const report = gradeReport(`${excerpt} y la tienda exige el ticket de compra original.`);
    // Forma válida.
    if (!report.ok) {
      // Si no, falla.
      throw new Error(report.reason);
    }
    // Parte de la respuesta directa.
    const direct = report.value.markdown.split("**Hallazgos")[0] ?? "";
    // Conserva la parte respaldada.
    expect(direct).toContain("reembolsa al comprador");
    // Sin el requisito.
    expect(direct).not.toContain("ticket de compra original");
    // Tampoco en el resto.
    expect(report.value.markdown).not.toContain("ticket de compra original");
  });

  // Una respuesta literal se muestra.
  it("mantiene visible una respuesta contenida en el extracto", () => {
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

  // Informe de prueba sobre los plazos de reembolso.
  function refundReport(answer: string, findingText: string) {
    // Extracto con las dos cifras.
    const source = "La tarjeta tarda 5 días hábiles y Bizum tarda 2 días hábiles.";
    // Subpregunta externa.
    const externalSub: PlanItem = {
      id: "q1",
      text: "Cuánto tardan los reembolsos con tarjeta y con Bizum.",
      kind: "external",
      external: true,
      query: "plazos reembolso tarjeta bizum",
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
      // Contexto: una subpregunta externa cubierta por «web-dim».
      {
        // Una subpregunta externa.
        subquestions: [externalSub],
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

  // Intercambiar los plazos de la tarjeta y de Bizum se rechaza.
  it("no acepta intercambiar los plazos de la tarjeta y de Bizum", () => {
    // Frase con las cifras cambiadas de sitio.
    const reversed = "La tarjeta tarda 2 días hábiles y Bizum tarda 5 días hábiles.";
    // Informe con esa frase.
    const report = refundReport(reversed, reversed);
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
    // Ni «tarjeta tarda 2».
    expect(report.value.markdown).not.toContain("tarjeta tarda 2");
    // Ni «Bizum tarda 5».
    expect(report.value.markdown).not.toContain("Bizum tarda 5");
  });

  // Intercambiar otras cifras entre sujetos también se rechaza.
  it("no acepta intercambiar otras cifras entre dos sujetos", () => {
    // Extracto con 6 y 9 horas.
    const source = "El envío a Baleares tarda 6 días y el envío a Portugal tarda 5 días.";
    // Frase con las cifras intercambiadas.
    const swapped = "El envío a Baleares tarda 5 días y el envío a Portugal tarda 6 días.";
    // Subpregunta externa.
    const externalSub: PlanItem = {
      id: "q1",
      text: "Cuánto tardan los envíos a Baleares y a Portugal.",
      kind: "external",
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
        // Una subpregunta externa.
        subquestions: [externalSub],
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
    expect(report.value.markdown).not.toContain("Baleares tarda 5");
    // Ni la frase.
    expect(report.value.markdown).not.toContain(swapped);
  });

  // Invertir quién hace qué se rechaza aunque las palabras coincidan.
  it("rechaza un cambio de orden que invierte quién reembolsa a quién", () => {
    // Frase con el orden invertido.
    const reversed = "El comprador reembolsa al vendedor cuando valida la devolución.";
    // Informe con esa frase.
    const report = gradeReport(reversed);
    // Forma válida.
    if (!report.ok) {
      // Si no, falla.
      throw new Error(report.reason);
    }
    // No aparece.
    expect(report.value.markdown).not.toContain("comprador reembolsa al vendedor");
    // Se retiró.
    expect(report.value.dropped.some((item) => item.claim.includes("comprador reembolsa"))).toBe(
      true,
    );
    // El extracto correcto sí aparece.
    expect(report.value.markdown).toContain(excerpt);
  });

  // El extracto original de los plazos se conserva entero.
  it("mantiene el extracto original de los plazos", () => {
    // Extracto.
    const source = "La tarjeta tarda 5 días hábiles y Bizum tarda 2 días hábiles.";
    // Informe que lo repite.
    const report = refundReport(source, source);
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
    // Con «tarjeta tarda 5».
    expect(report.value.markdown).toContain("tarjeta tarda 5");
    // Y «Bizum tarda 2».
    expect(report.value.markdown).toContain("Bizum tarda 2");
  });

  // La versión afirmativa de una frase negada no se muestra.
  it("no muestra la versión afirmativa de una frase negada en el extracto", () => {
    // Frase negada del extracto.
    const negative = "Los auriculares intraauditivos no se pueden devolver después de abrirlos.";
    // Versión afirmativa.
    const positive = "Los auriculares intraauditivos se pueden devolver después de abrirlos.";
    // Subpregunta externa.
    const externalSub: PlanItem = {
      id: "q1",
      text: "Si los auriculares intraauditivos se pueden devolver.",
      kind: "external",
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
        // Una subpregunta externa.
        subquestions: [externalSub],
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
