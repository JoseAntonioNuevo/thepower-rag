// GUÍA DE LECTURA · scripts/compare-crag-models.ts
// Comparación dirigida del evaluador/reformulador/generador con fragmentos congelados del curso.
// Sin --execute solo imprime un plan. El lote de pago exige presupuesto y un run nuevo, sin reintentos.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAllowanceLedger,
  OPERATION_BOUNDS,
  ALLOWANCE_MARGIN,
  validateRankingAndAssessment,
  validateReformulation,
  type CragChunk,
} from "@thepower-rag/core";
import { COURSE_MODEL_PROFILES } from "../apps/api/src/course-models";
import { createRealCragPorts } from "../apps/api/src/crag-real";
import { createEvaluatorModel, createGenerationModel } from "../apps/api/src/model";
import { generationPricing, tokenEstimateConsumption } from "../apps/api/src/provider-cost";
import { readRepoAnthropicKey, readRepoAnthropicWorkspaceId } from "./anthropic-key";
import type { EmbeddingRunner } from "../apps/api/src/vectors";
import type { SqlDatabase, VectorIndex } from "../apps/api/src/stores";

// Mantiene la misma respuesta final al aislar el efecto de cambiar solo el evaluador.
export const COMPARISON_PROFILES = {
  haiku: { generator: COURSE_MODEL_PROFILES.haiku, evaluator: COURSE_MODEL_PROFILES.haiku },
  "sonnet-evaluator": {
    generator: COURSE_MODEL_PROFILES.haiku,
    evaluator: COURSE_MODEL_PROFILES.sonnet,
  },
  sonnet: { generator: COURSE_MODEL_PROFILES.sonnet, evaluator: COURSE_MODEL_PROFILES.sonnet },
  opus: { generator: COURSE_MODEL_PROFILES.opus, evaluator: COURSE_MODEL_PROFILES.opus },
} as const;
type ProfileName = keyof typeof COMPARISON_PROFILES;

// Casos de desarrollo, no el conjunto reservado de 20 preguntas de S10/S11.
export const DIRECTED_CASES = [
  {
    id: "estado",
    question: "¿Cómo representa LangGraph el estado y los nodos de un agente?",
    docs: ["s05-langgraph"],
    expected: "sufficient",
  },
  {
    id: "parcial",
    question: "¿Cómo representa LangGraph el estado y cómo se observa la ejecución con Langfuse?",
    docs: ["s05-langgraph"],
    expected: "partial",
  },
  {
    id: "combinado",
    question: "¿Cómo representa LangGraph el estado y cómo se observa la ejecución con Langfuse?",
    docs: ["s05-langgraph", "s06-observabilidad"],
    expected: "sufficient",
  },
  {
    id: "irrelevante",
    question: "¿Cómo se representa el estado de un agente en LangGraph?",
    docs: ["s16-cloud-aws"],
    expected: "insufficient",
  },
  {
    id: "ausente",
    question: "¿Qué beca interna de 1991 financia este curso?",
    docs: ["s05-langgraph", "s06-observabilidad"],
    expected: "insufficient",
  },
] as const;

// Cota conservadora del prompt dirigido, incluidos esquema e instrucciones. Las entradas son fijas.
const INPUT_BOUND = 20_000;

// Plan sin credenciales ni red. La reserva usa la tarifa máxima y no descuenta estimaciones como factura.
export function modelComparisonPlan(names: string[]) {
  // Exige perfiles conocidos, no vacíos y sin duplicados antes de estimar llamadas o gasto.
  if (
    !names.length ||
    new Set(names).size !== names.length ||
    names.some((n) => !Object.hasOwn(COMPARISON_PROFILES, n))
  ) {
    // Rechaza también claves heredadas del prototipo, como constructor, que no son perfiles propios.
    throw new Error("Perfiles inválidos o repetidos.");
  }
  // Tras validar los nombres, los trata como claves del catálogo de perfiles.
  const profiles = names as ProfileName[];
  // Reúne generador y evaluador de cada perfil porque ambos pueden consumir tokens.
  const models = profiles.flatMap((n) => [
    COMPARISON_PROFILES[n].generator,
    COMPARISON_PROFILES[n].evaluator,
  ]);
  // Reserva usando la tarifa de entrada más alta de todos los papeles seleccionados.
  const inputPrice = Math.max(...models.map((m) => m.inputUsdPerMillion));
  // Hace lo mismo con la tarifa de salida para no infravalorar al evaluador más caro.
  const outputPrice = Math.max(...models.map((m) => m.outputUsdPerMillion));
  // Suma cinco evaluaciones, una reformulación y una generación con margen conservador.
  const perProfile =
    (ALLOWANCE_MARGIN *
      (5 * (INPUT_BOUND * inputPrice + OPERATION_BOUNDS.evaluation.maxOutputTokens * outputPrice) +
        INPUT_BOUND * inputPrice +
        OPERATION_BOUNDS.reformulation.maxOutputTokens * outputPrice +
        INPUT_BOUND * inputPrice +
        OPERATION_BOUNDS.generation.maxOutputTokens * outputPrice)) /
    1_000_000;
  // Devuelve un plan calculable sin claves, red ni llamadas de inferencia.
  return {
    profiles,
    calls: profiles.length * 7,
    worstCaseUsd: perProfile * profiles.length,
    inputPrice,
    outputPrice,
    methodology: "fixed-candidates-development-only",
  };
}

// Un run es inmutable: reiniciar con el mismo nombre no repite una operación cuyo cargo puede existir.
async function main() {
  // Lee las opciones de esta ejecución omitiendo el ejecutable y el nombre del script.
  const args = process.argv.slice(2);
  // Obtiene el argumento situado después de la bandera; el llamador comprueba cuándo está presente.
  const arg = (flag: string) => args[args.indexOf(flag) + 1];
  // La selección explícita usa nombres separados por coma; sin bandera se comparan todos los perfiles.
  const selected = args.includes("--profiles")
    ? (arg("--profiles")?.split(",") ?? [])
    : Object.keys(COMPARISON_PROFILES);
  // Valida la selección y calcula la reserva antes de decidir si se ejecutará.
  const plan = modelComparisonPlan(selected);
  // Sin --execute el script se limita a imprimir el plan de desarrollo.
  if (!args.includes("--execute")) {
    // Muestra casos, coste máximo y necesidad de revisión humana antes de cualquier pago.
    console.log(
      JSON.stringify(
        { ...plan, execute: false, cases: DIRECTED_CASES, manualReviewRequired: true },
        null,
        2,
      ),
    );
    // Sale del modo plan antes de leer credenciales o crear un directorio de ejecución.
    return;
  }
  // Convierte el tope explícito a número; si falta deja NaN para que la validación lo rechace.
  const budget = args.includes("--max-spend-usd") ? Number(arg("--max-spend-usd")) : NaN;
  // Cada ejecución pagada necesita un identificador propio que no se reutilice.
  const run = args.includes("--run") ? arg("--run") : undefined;
  // Exige saldo para todo el plan y un nombre sencillo, acotado y seguro para el directorio.
  if (
    !Number.isFinite(budget) ||
    budget < plan.worstCaseUsd ||
    !run ||
    !/^[a-z0-9-]{1,64}$/.test(run)
  ) {
    // Detiene el lote antes de leer claves cuando faltan condiciones de ejecución.
    throw new Error("Falta --run nuevo y --max-spend-usd suficiente para la reserva del plan.");
  }
  // Ancla rutas al repositorio del script para no tomar archivos de otro proyecto.
  const root = path.resolve(import.meta.dirname, "..");
  // Lee la clave mediante el contrato de credenciales específico del repositorio.
  const key = readRepoAnthropicKey(root);
  // Obtiene el workspace del mismo contrato para mantener la atribución del proveedor.
  const workspaceId = readRepoAnthropicWorkspaceId(root);
  // Sin clave del proyecto no se inicia ninguna llamada del lote.
  if (!key) throw new Error("Falta la clave Anthropic del propio repositorio.");
  // Conserva los bytes del corpus para poder registrar su huella exacta.
  const bytes = readFileSync(path.join(root, "corpus/prepared/corpus.json"));
  // Carga documentos y fragmentos preparados sin volver a trocear durante la comparación.
  const corpus = JSON.parse(bytes.toString()) as {
    preparationId: string;
    documents: {
      id: string;
      title: string;
      audience: string;
      chunks: { chunkId: string; text: string; section: string }[];
    }[];
  };
  // Sitúa los recibos del comparador dentro del directorio privado de activación.
  const parent = path.join(root, "activation-receipts/model-comparison");
  // Crea solo el directorio padre común a los distintos ensayos.
  mkdirSync(parent, { recursive: true });
  // Asigna una ruta exclusiva al identificador de esta ejecución.
  const destination = path.join(parent, run);
  // La creación sin recursive falla si el ensayo ya existe e impide repetir cargos inciertos.
  mkdirSync(destination); // Falla si ya existe, antes de toda llamada de pago.
  // Acumula resultados o errores de cada operación dirigida.
  const results: Record<string, unknown>[] = [];
  // Registra por separado los tokens observados y sus estimaciones de coste.
  const usage: Record<string, unknown>[] = [];
  // Construye un diario que limita gasto y llamadas, sin permitir embeddings en este experimento.
  const ledger = createAllowanceLedger({
    maxSpendUsd: budget,
    maxGenerativeCalls: plan.calls,
    maxEmbeddingCalls: 0,
    prices: {
      embeddingUsdPerMillionInput: null,
      generativeUsdPerMillionInput: plan.inputPrice,
      generativeUsdPerMillionOutput: plan.outputPrice,
    },
  });
  // Guarda el estado actual del recorrido para que los resultados sobrevivan a una interrupción.
  const persist = () =>
    writeFileSync(
      path.join(destination, "results.json"),
      JSON.stringify(
        {
          plan,
          corpusSha256: createHash("sha256").update(bytes).digest("hex"),
          results,
          usage,
          allowance: ledger.snapshot(),
          actualProviderUsd: null,
          manualReviewRequired: true,
        },
        null,
        2,
      ) + "\n",
    );
  // Escribe el estado inicial para conservar evidencia incluso si el primer intento falla.
  persist();
  // Declara el corpus y el perfil fijo; esta prueba no mide la recuperación vectorial.
  const scope = {
    runId: run,
    audience: "program" as const,
    corpusVersion: corpus.preparationId,
    profileId: "fixed-candidates-comparison",
    embeddingLabel: "not-used-no-retrieval-benchmark",
  };
  // Selecciona fragmentos fijos del corpus del programa para comparar modelos con la misma evidencia.
  const chunks = (ids: readonly string[]): CragChunk[] => {
    // Filtra documentos del programa y añade a sus fragmentos la identidad del ensayo congelado.
    const selected = corpus.documents
      .filter((d) => ids.includes(d.id) && d.audience === "program")
      .flatMap((d) =>
        d.chunks.map((c) => ({
          ...c,
          documentId: d.id,
          title: d.title,
          audience: "program" as const,
          corpusVersion: scope.corpusVersion,
          profileId: scope.profileId,
          score: 0.9,
        })),
      );
    // Esta prueba usa contextos pequeños fijos. Un corpus ampliado no puede exceder la reserva
    // de 20.000 tokens sin preparar otro plan. Se acotan bytes, también para texto no ASCII.
    if (selected.length > 10 || Buffer.byteLength(JSON.stringify(selected), "utf8") > 12_000) {
      // No envía contextos que excedan la cota de bytes usada para presupuestar el plan.
      throw new Error(
        "Los candidatos superan el tamaño del plan dirigido. No se envía la llamada.",
      );
    }
    // Entrega únicamente los fragmentos seleccionados por el caso dirigido.
    return selected;
  };
  // Repite exactamente los mismos casos para cada pareja de modelos del plan.
  for (const name of plan.profiles) {
    // Resuelve generador y evaluador desde el catálogo validado.
    const profile = COMPARISON_PROFILES[name];
    // Agrupa la identidad del generador y la credencial del workspace del proyecto.
    const generatorConfig = { apiKey: key, modelId: profile.generator.modelId, workspaceId };
    // Construye puertos CRAG reales; el lote suministra candidatos fijos y no usa búsqueda vectorial.
    const ports = createRealCragPorts({
      signal: new AbortController().signal,
      scope,
      embedder: {} as EmbeddingRunner,
      index: {} as VectorIndex,
      database: {} as SqlDatabase,
      evaluator: createEvaluatorModel({
        ...generatorConfig,
        evaluatorModelId: profile.evaluator.modelId,
      }),
      generator: createGenerationModel(generatorConfig),
      messages: [],
      embeddingModel: "not-used",
      dimensions: 1024,
      costPricing: generationPricing(generatorConfig),
      generationTimeoutMs: 30_000,
      // La envoltura amplía la reserva al prompt conservador y la escribe antes de enviar.
      allowance: {
        ...ledger,
        // Comprueba o registra la reserva previa que permite continuar con una operación de pago.
        reserve: (input) => {
          // Amplía la reserva de entrada a la cota conservadora del experimento.
          const reserved = ledger.reserve({ ...input, maxInputTokens: INPUT_BOUND });
          // Guarda la reserva antes de permitir que el puerto envíe la llamada.
          persist();
          // Devuelve el permiso o rechazo del diario al adaptador real.
          return reserved;
        },
      },
      // Asocia los tokens observados al papel del modelo y calcula su estimación de coste.
      onUsage: (kind, tokens) => {
        // Aplica las tarifas del generador o del evaluador según el papel de la llamada.
        const rates = kind === "generation" ? profile.generator : profile.evaluator;
        // Calcula una estimación solo con los tokens que el proveedor haya informado.
        const consumption = tokenEstimateConsumption(tokens, rates);
        // Añade el consumo del papel actual y deja explícita la completitud de la estimación.
        usage.push({
          profile: name,
          kind,
          ...tokens,
          usdEstimate: consumption.kind === "estimated" ? consumption.usd : null,
          estimateComplete: consumption.kind === "estimated" && consumption.complete,
        });
      },
    });
    // Envuelve una operación dirigida con reserva previa, captura de resultado o error y persistencia.
    const call = async (
      id: string,
      kind: "evaluation" | "reformulation" | "generation",
      operation: () => Promise<unknown>,
    ) => {
      // Solicita permiso al presupuesto antes de invocar la operación dirigida.
      const reservation = ports.reserve(kind);
      // Detiene la siguiente llamada si ya no cabe en el diario del lote.
      if (!reservation.ok) throw new Error("El lote agotó la reserva antes de otra llamada.");
      // Marca el inicio para medir la duración completa, incluida la espera al proveedor.
      const started = Date.now();
      // Conserva tanto resultados como errores sin reintentar automáticamente la operación.
      try {
        // Añade identidad y resultado de la llamada; la latencia se completa después de resolverla.
        results.push({
          profile: name,
          id,
          kind,
          latencyMs: Date.now() - started,
          result: await operation(),
        });
      } catch (error) {
        // Registra el tipo de error y el tiempo transcurrido sin copiar mensajes sensibles del proveedor.
        results.push({
          profile: name,
          id,
          kind,
          error: error instanceof Error ? error.name : "unknown",
          latencyMs: Date.now() - started,
        });
      }
      // La latencia se completa después de resolver la promesa, no antes.
      results[results.length - 1]!.latencyMs = Date.now() - started;
      // Guarda el resultado o fallo y el saldo antes de pasar a otro caso.
      persist();
    };
    // Recorre los cinco casos de desarrollo con candidatos documentales idénticos entre perfiles.
    for (const sample of DIRECTED_CASES) {
      // Obtiene los fragmentos del corpus que define el caso, sin hacer una búsqueda nueva.
      const evidence = chunks(sample.docs);
      // Un caso sin su evidencia fija no sirve para comparar evaluadores y se detiene.
      if (!evidence.length) throw new Error("Falta el corpus del caso dirigido.");
      // Pasa la evaluación por la envoltura común que reserva y conserva su resultado.
      await call(sample.id, "evaluation", async () => {
        // Pide ordenar candidatos y valorar suficiencia con la misma pregunta y el primer intento.
        const result = await ports.rankAndAssess({
          question: sample.question,
          query: sample.question,
          chunks: evidence,
          attempt: 1,
          remainingMs: 30_000,
        });
        // Valida que la salida respete el contrato y solo use los candidatos suministrados.
        const parsed = result.ok ? validateRankingAndAssessment(evidence, result.raw) : result;
        // Guarda tanto la salida como su validación y la coincidencia con el estado esperado.
        return {
          ...result,
          validation: parsed,
          expected: sample.expected,
          expectedMatched:
            parsed.ok && "assessment" in parsed
              ? parsed.assessment.status === sample.expected
              : false,
        };
      });
    }
    // Reutiliza la pregunta parcial para observar cómo propone una búsqueda adicional cada perfil.
    const question = DIRECTED_CASES[1]!.question;
    // Reserva y ejecuta una reformulación sobre la misma carencia de observabilidad.
    await call("reformulacion", "reformulation", async () => {
      // Solicita otra consulta con el mismo intento y plazo para todos los modelos.
      const result = await ports.reformulate({
        question,
        query: question,
        gaps: ["Falta observabilidad"],
        attempt: 1,
        remainingMs: 30_000,
      });
      // Conserva la reformulación y comprueba que no repita la pregunta anterior.
      return {
        ...result,
        validation: result.ok ? validateReformulation(result.raw, [question]) : null,
      };
    });
    // Genera una respuesta sobre la evidencia combinada con la misma envoltura de reserva.
    await call("respuesta", "generation", () =>
      ports.generate({ question, evidence: chunks(DIRECTED_CASES[2]!.docs), remainingMs: 30_000 }),
    );
  }
  // Publica la ruta del recibo y recuerda que el contenido todavía requiere revisión humana.
  console.log(
    JSON.stringify({ directory: destination, calls: results.length, manualReviewRequired: true }),
  );
}

// Importar el plan desde una prueba no ejecuta el CLI ni lee credenciales.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  // Ejecuta el CLI solo cuando este archivo es el punto de entrada del proceso.
  await main();
