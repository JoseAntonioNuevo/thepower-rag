// GUÍA DE LECTURA · scripts/runtime.test.ts
// Pruebas del plano de datos sin red: cuándo arranca el puente, sonda, ingesta, reanudación sin reembeber,
// selección del perfil activo, verificación que no cabe, arranque del puente en loopback y puente HTTP.
// Archivos temporales.
import { mkdtemp, readFile, rm } from "node:fs/promises";
// Sistema operativo.
import os from "node:os";
// Rutas.
import path from "node:path";
// Identidad del corpus, nombre del índice y tipo.
import { semanticIdentity, vectorizeIndexName, type PreparedCorpus } from "@thepower-rag/core";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Bindings y plano de datos en memoria.
import { createMemoryBindings, createMemoryDataPlane } from "../apps/api/src/memory-bindings";
// Puente que se prueba.
import { handleBridgeRequest } from "../apps/api/src/bridge-worker";
// Tipo de la autorización.
import type { ActivationAuth } from "./activation";
// Ejecutor del curso.
import { createCourseExecutor } from "./course-executor";
// Sesión de gasto.
import { createAllowanceLedger } from "@thepower-rag/core";
// Configuración y arranque del puente.
import { bridgeWranglerConfig, startLoopbackBridge } from "./loopback-bridge";
// ¿Arrancar el puente?
import { shouldStartRuntime } from "./runtime-plane";
// Cuenta del curso.
import { COURSE_DESTINATION } from "./course-destination";

// Raíz.
const root = path.resolve(import.meta.dirname, "..");

// Autorización completa de prueba.
function auth(overrides: Partial<ActivationAuth> = {}): ActivationAuth {
  // Cuenta del curso con permisos de datos y tope de 5 USD.
  return {
    // Cuenta, nombre y correo del destino del curso.
    accountId: COURSE_DESTINATION.accountId,
    accountName: COURSE_DESTINATION.accountName,
    loginEmail: COURSE_DESTINATION.loginEmail,
    // No se crean recursos en estas pruebas.
    allowCreateD1: false,
    allowCreateR2: false,
    allowCreateVectorize: false,
    // Sí se permiten embeddings y modelo, con un tope de 5 USD.
    allowWorkersAi: true,
    allowOpenRouter: true,
    modelId: "example/generator",
    maxSpendUsd: 5,
    // Sin cambios de plan y con la dimensión ya observada.
    allowPlanChange: false,
    observedDimensions: 32,
    // Cada prueba puede cambiar lo que necesite.
    ...overrides,
  };
}

// Corpus mínimo de un documento.
function corpus(): PreparedCorpus {
  // Corpus.
  return {
    // Ids y fecha del corpus preparado.
    contentVersion: "cc037ef0bb1f7",
    preparationId: "c3a59a406888b",
    version: "test",
    verifiedDate: "2026-10-03",
    // Perfil léxico de prueba de 128 dimensiones.
    embeddingModel: "fixture-token-hash-v1",
    dimensions: 128,
    remoteRevision: null,
    // Cobertura parcial y sin verificación remota.
    coverage: {
      curriculum: "partial",
      calendarLx: "partial",
      calendarMj: "partial",
      exerciseDetail: "partial",
      remote: "not-verified",
      sessions: [],
    },
    // Perfil del índice de prueba.
    indexProfile: {
      id: "p9e8e8e03627e",
      family: "fixture",
      model: "fixture-token-hash-v1",
      dimensions: 128,
      metric: "cosine",
      chunkMaxChars: 900,
      chunkOverlap: 80,
      providerRevision: null,
      preparationId: "c3a59a406888b",
    },
    // Un único documento (S5) con un fragmento.
    documents: [
      {
        id: "s05-langgraph",
        title: "S5",
        audience: "program",
        session: "S5",
        verified: "2026-10-03",
        source: "temario",
        sourcePath: "program/s05-langgraph.md",
        sourceHash: "hash-s5",
        curriculum: "present",
        exerciseDetail: "summary",
        body: "LangGraph modela el estado.",
        // Su fragmento con el id de vector.
        chunks: [
          {
            chunkId: "c3a59a406888b:s05-langgraph:00",
            vectorId: "v-s05",
            section: "S5",
            text: "LangGraph modela el estado.",
            ordinal: 0,
          },
        ],
      },
    ],
  };
}

// Grupo.
describe("puente y comandos", () => {
  // No arranca en simulación ni en lectura.
  it("no arranca el runtime en simulación ni en lectura", () => {
    // plan.
    expect(shouldStartRuntime("plan", false, false)).toBe(false);
    // Sonda sin --execute.
    expect(shouldStartRuntime("probe-embeddings", false, false)).toBe(false);
    // status en lectura.
    expect(shouldStartRuntime("status", false, true)).toBe(false);
    // Sonda ejecutada: sí.
    expect(shouldStartRuntime("probe-embeddings", true, false)).toBe(true);
    // Lectura: no.
    expect(shouldStartRuntime("verify", true, true)).toBe(false);
  });

  // Sonda, ingesta, reanudación y selección del perfil.
  it("sonda, ingesta, reanuda sin reembeber y no activa un perfil a medias", async () => {
    // Corpus real antes.
    const before = await readFile(path.join(root, "corpus/prepared/corpus.json"), "utf8");
    // Parseado.
    const prepared = JSON.parse(before) as PreparedCorpus;
    // Otro perfil que el de prueba.
    expect(semanticIdentity(prepared, 32).id).not.toBe("p9e8e8e03627e");
    // Carpeta temporal.
    const directory = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-runtime-"));
    // Rutas de recibos y caché.
    const paths = {
      receiptDir: directory,
      cacheDir: path.join(directory, "cache"),
      now: "2026-10-03T12:00:00.000Z",
    };
    // Bindings que tardan en hacer visibles los vectores.
    const bindings = createMemoryBindings({ dimensions: 32, visibleAfterReads: 2 });
    // Llamadas de embeddings.
    let embedCalls = 0;
    // Perfil semántico.
    const profileId = semanticIdentity(corpus(), 32).id;
    // Plano de datos en memoria.
    const plane = createMemoryDataPlane({
      bindings,
      management: {
        metric: "cosine",
        dimensions: 32,
        name: vectorizeIndexName(profileId),
        metadataIndexes: ["corpusVersion", "audience", "profileId"],
      },
      // Doble de prueba: convierte los textos en vectores mediante el proveedor que implementa este puerto.
      embed: async (texts) => {
        // Cuenta.
        embedCalls += 1;
        // Vectores fijos.
        return {
          vectors: texts.map(() => Array.from({ length: 32 }, () => 0.1)),
          providerRevision: null,
        };
      },
    });
    // Sesión de gasto.
    const allowance = createAllowanceLedger({
      maxSpendUsd: 5,
      maxGenerativeCalls: 4,
      maxEmbeddingCalls: 8,
      prices: {
        embeddingUsdPerMillionInput: 0.0118,
        generativeUsdPerMillionInput: 1,
        generativeUsdPerMillionOutput: 2,
      },
    });
    // Ejecutor con plano de datos.
    const executor = createCourseExecutor({
      cwd: root,
      migrationsDir: path.join(root, "apps/api/migrations"),
      corpusPath: path.join(root, "corpus/prepared/corpus.json"),
      corpus: corpus(),
      plane,
      allowance,
      paths,
      runner: {
        // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
        run: async () => ({ code: 0, stdout: "", stderr: "" }),
      },
    });
    // Ejecutor sin plano de datos.
    const blocked = createCourseExecutor({
      cwd: root,
      migrationsDir: path.join(root, "apps/api/migrations"),
      corpusPath: path.join(root, "corpus/prepared/corpus.json"),
      runner: {
        // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
        run: async () => ({ code: 0, stdout: "", stderr: "" }),
      },
    });
    // Sin plano: no conectado.
    expect((await blocked.probeEmbeddings(auth())).summary).toContain("no está conectado");
    // Sonda.
    const probe = await executor.probeEmbeddings(auth());
    // Correcta.
    expect(probe.ok).toBe(true);
    // Recibo sin cargo medido.
    expect(probe.receipt).toMatchObject({
      dimensions: 32,
      providerRevision: null,
      measuredChargeUsd: null,
      provenance: "fixture",
      live: false,
      usableForRemoteIndex: false,
    });
    // Recibo guardado.
    const receipt = JSON.parse(
      await readFile(path.join(directory, "probe-embeddings.json"), "utf8"),
    ) as {
      // Dimensiones medidas.
      dimensions: number;
    };
    // 32 dimensiones.
    expect(receipt.dimensions).toBe(32);
    // Ingesta.
    const ingested = await executor.ingest(auth());
    // Correcta.
    expect(ingested.ok).toBe(true);
    // Lista con una llamada y una escritura.
    expect(ingested.receipt).toMatchObject({ phase: "ready", embedCalls: 1, upserts: 1 });
    // Embeddings tras la ingesta.
    const embedsAfterIngest = embedCalls;
    // Reanuda.
    const resumed = await executor.resume(auth(), profileId);
    // Correcta.
    expect(resumed.ok).toBe(true);
    // Sin llamadas ni escrituras.
    expect(resumed.receipt).toMatchObject({ embedCalls: 0, upserts: 0 });
    // No reembebió.
    expect(embedCalls).toBe(embedsAfterIngest);
    // Selecciona el perfil.
    const selected = await executor.selectActive(auth(), profileId);
    // Correcto.
    expect(selected.ok).toBe(true);
    // Activo.
    expect(selected.receipt).toMatchObject({ activeId: profileId });
    // Añade un perfil a medias.
    bindings.tables.index_profiles.push({
      id: "p0123456789ab",
      status: "partial",
      active: 0,
      corpus_version: "c3a59a406888b",
    });
    // Seleccionarlo falla.
    const rejected = await executor.selectActive(auth(), "p0123456789ab");
    // Falla.
    expect(rejected.ok).toBe(false);
    // El activo no cambia.
    expect(rejected.receipt).toMatchObject({ activeId: profileId });
    // Archivo de caché.
    const cacheFile = path.join(paths.cacheDir, `${profileId}.json`);
    // Caché.
    const cache = JSON.parse(await readFile(cacheFile, "utf8")) as { profileId: string };
    // Le cambia el perfil.
    cache.profileId = "p0123456789ab";
    // writeFile.
    const { writeFile } = await import("node:fs/promises");
    // Lo guarda.
    await writeFile(cacheFile, JSON.stringify(cache));
    // Reanudar con caché ajena.
    const mismatch = await executor.resume(auth(), profileId);
    // Falla.
    expect(mismatch.ok).toBe(false);
    // Sin embeddings.
    expect(mismatch.receipt).toMatchObject({ embedCalls: 0 });
    // Sin reembeber.
    expect(embedCalls).toBe(embedsAfterIngest);
    // El corpus real no cambió.
    expect(await readFile(path.join(root, "corpus/prepared/corpus.json"), "utf8")).toBe(before);
    // Borra la carpeta.
    await rm(directory, { recursive: true, force: true });
  });

  // Si la verificación no cabe en la sesión, no llama al proveedor.
  it("no llama al proveedor si el plan de verificación no cabe", async () => {
    // Llamadas.
    let calls = 0;
    // Ejecutor con límites pequeños.
    const executor = createCourseExecutor({
      cwd: root,
      migrationsDir: path.join(root, "apps/api/migrations"),
      corpusPath: path.join(root, "corpus/prepared/corpus.json"),
      runner: {
        // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
        run: async () => ({ code: 0, stdout: "", stderr: "" }),
      },
      sessionPrices: {
        embeddingUsdPerMillionInput: 1,
        generativeUsdPerMillionInput: 1,
        generativeUsdPerMillionOutput: 1,
      },
      sessionLimits: { generative: 3, embedding: 8 },
      // Doble de prueba: comprueba el recorrido completo con el alcance e identidades de la sesión.
      verifySession: async () => {
        // Cuenta.
        calls += 1;
        // Resultado.
        return { ok: true, summary: "no debía llamarse" };
      },
    });
    // Verifica.
    const result = await executor.verify(auth({ maxSpendUsd: 100 }));
    // Falla.
    expect(result.ok).toBe(false);
    // Sin llamadas.
    expect(result.receipt).toMatchObject({ calls: 0 });
    // Cero.
    expect(calls).toBe(0);
  });

  // Arranca y para un solo proceso en loopback.
  it("arranca y apaga un solo proceso de loopback sin publicarlo", async () => {
    // Especificación local.
    const spec = {
      accountId: COURSE_DESTINATION.accountId,
      port: 9,
      inspectorPort: 10,
      remote: false,
      token: "testigo-local-de-prueba",
      projectRoot: root,
      role: "probe" as const,
      persistDir: "/tmp/thepower-rag-bridge-test",
    };
    // Configuración de wrangler.
    const config = bridgeWranglerConfig(spec);
    // Solo 127.0.0.1.
    expect(config.dev).toMatchObject({ ip: "127.0.0.1" });
    // Worker del puente.
    expect(config.main).toBe(`${root}/apps/api/src/bridge-worker.ts`);
    // Nunca 0.0.0.0.
    expect(JSON.stringify(config)).not.toContain("0.0.0.0");
    // Sin Workers AI.
    expect(config.ai).toBeUndefined();
    // Sin Vectorize.
    expect(config.vectorize).toBeUndefined();
    // Sin D1.
    expect(config.d1_databases).toBeUndefined();
    // Sonda remota.
    const remoteProbe = bridgeWranglerConfig({ ...spec, remote: true });
    // Workers AI remoto.
    expect(remoteProbe.ai).toEqual({ binding: "AI", remote: true });
    // Sin Vectorize.
    expect(remoteProbe.vectorize).toBeUndefined();
    // Storage remoto sin UUID: error.
    expect(() =>
      bridgeWranglerConfig({
        ...spec,
        role: "storage",
        remote: true,
        indexName: "thepower-ai-course-rag-0123456789ab",
      }),
    ).toThrow(/uuid/);
    // Procesos parados.
    const killed: number[] = [];
    // Arranque simulado.
    const started = await startLoopbackBridge(spec, {
      timeoutMs: 1_000,
      // Doble de prueba: proporciona el reloj del recorrido para calcular plazos y tiempos transcurridos.
      now: () => 0,
      // Doble de prueba: representa la espera del recorrido mediante el reloj o temporizador inyectado.
      sleep: async () => undefined,
      // Doble de prueba: arranca el proceso hijo del puente y devuelve los controles de su ciclo de vida.
      spawn: (_command, args) => {
        // Escucha en 127.0.0.1.
        expect(args).toContain("--ip");
        // IP.
        expect(args).toContain("127.0.0.1");
        // Local.
        expect(args).toContain("--local");
        // No remoto.
        expect(args).not.toContain("--remote");
        // La ficha no va en los argumentos.
        expect(args.join(" ")).not.toContain(spec.token);
        // Proceso simulado.
        return {
          pid: 42,
          // Doble de prueba: solicita terminar el proceso hijo y deja su limpieza al controlador del recorrido.
          kill: () => killed.push(42),
          // Doble de prueba: informa si el proceso hijo ya terminó para evitar tratarlo como un puente disponible.
          hasExited: () => false,
          // Doble de prueba: espera la terminación del proceso hijo antes de dar por liberados sus recursos.
          waitForExit: async () => 0,
        };
      },
      // Doble de prueba: atiende la petición HTTP con el adaptador y el entorno de este recorrido.
      fetch: async () => ({ status: 200, body: { ok: true, bind: "127.0.0.1" } }),
    });
    // PID.
    expect(started.pid).toBe(42);
    // Para.
    await started.shutdown();
    // Parado.
    expect(killed).toEqual([42]);
    // Intentos de conexión.
    let fetches = 0;
    // Arranque que falla la primera vez.
    const retried = await startLoopbackBridge(spec, {
      timeoutMs: 1_000,
      // Doble de prueba: proporciona el reloj del recorrido para calcular plazos y tiempos transcurridos.
      now: () => 0,
      // Doble de prueba: representa la espera del recorrido mediante el reloj o temporizador inyectado.
      sleep: async () => undefined,
      // Doble de prueba: arranca el proceso hijo del puente y devuelve los controles de su ciclo de vida.
      spawn: () => ({
        pid: 8,
        // Doble de prueba: solicita terminar el proceso hijo y deja su limpieza al controlador del recorrido.
        kill: () => undefined,
        // Doble de prueba: informa si el proceso hijo ya terminó para evitar tratarlo como un puente disponible.
        hasExited: () => false,
        // Doble de prueba: espera la terminación del proceso hijo antes de dar por liberados sus recursos.
        waitForExit: async () => 0,
      }),
      // Doble de prueba: atiende la petición HTTP con el adaptador y el entorno de este recorrido.
      fetch: async () => {
        // Cuenta.
        fetches += 1;
        // Primer intento.
        if (fetches === 1) {
          // Rechazado.
          throw new Error("connect ECONNREFUSED");
        }
        // Listo.
        return { status: 200, body: { ok: true, bind: "127.0.0.1" } };
      },
    });
    // Dos intentos.
    expect(fetches).toBe(2);
    // Registrados.
    expect(retried.attempts).toBe(2);
    // Para.
    await retried.shutdown();
    // Sin tiempo: error y proceso parado.
    await expect(
      startLoopbackBridge(spec, {
        // Plazo cero: el puente no llega a estar listo.
        timeoutMs: 0,
        // Doble de prueba: proporciona el reloj del recorrido para calcular plazos y tiempos transcurridos.
        now: () => 10,
        // Doble de prueba: representa la espera del recorrido mediante el reloj o temporizador inyectado.
        sleep: async () => undefined,
        // Proceso simulado que no termina por sí solo.
        spawn: () => ({
          pid: 7,
          // Doble de prueba: solicita terminar el proceso hijo y deja su limpieza al controlador del recorrido.
          kill: () => killed.push(7),
          // Doble de prueba: informa si el proceso hijo ya terminó para evitar tratarlo como un puente disponible.
          hasExited: () => false,
          // Doble de prueba: espera la terminación del proceso hijo antes de dar por liberados sus recursos.
          waitForExit: async () => 0,
        }),
        // El puente responde 503 (aún no listo).
        fetch: async () => ({ status: 503 }),
      }),
    ).rejects.toThrow(/no estuvo listo/);
    // Parado.
    expect(killed).toContain(7);
  });

  // El puente rechaza otro host y devuelve la dimensión real.
  it("el puente rechaza otro host y devuelve la dimensión observada", async () => {
    // Otro host.
    const denied = await handleBridgeRequest(new Request("http://example.com/bridge/ready"), {
      BRIDGE_TOKEN: "testigo-local-de-prueba",
    });
    // 404.
    expect(denied.status).toBe(404);
    // Llamadas remotas.
    let remoteCalls = 0;
    // Embed con reserva.
    const response = await handleBridgeRequest(
      // Petición POST al puente con la ficha local.
      new Request("http://127.0.0.1/bridge", {
        method: "POST",
        headers: { "x-thepower-bridge": "testigo-local-de-prueba" },
        // Operación embed con su reserva y dos textos.
        body: JSON.stringify({
          op: "embed",
          reservationId: "r1",
          texts: ["uno", "dos"],
        }),
      }),
      // Entorno del puente: ficha, modo remoto y papel «probe».
      {
        BRIDGE_TOKEN: "testigo-local-de-prueba",
        BRIDGE_REMOTE: "true",
        BRIDGE_ROLE: "probe",
        AI: {
          // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
          run: async () => {
            // Cuenta.
            remoteCalls += 1;
            // Dos vectores de 32.
            return {
              data: [Array.from({ length: 32 }, () => 0.2), Array.from({ length: 32 }, () => 0.2)],
            };
          },
        },
      },
    );
    // Embed sin reserva.
    const skipped = await handleBridgeRequest(
      new Request("http://127.0.0.1/bridge", {
        method: "POST",
        headers: { "x-thepower-bridge": "testigo-local-de-prueba" },
        body: JSON.stringify({ op: "embed", texts: ["uno", "dos"] }),
      }),
      {
        BRIDGE_TOKEN: "testigo-local-de-prueba",
        BRIDGE_REMOTE: "true",
        AI: {
          // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
          run: async () => {
            // Cuenta.
            remoteCalls += 1;
            // Sin vectores.
            return { data: [] };
          },
        },
      },
    );
    // 400.
    expect(skipped.status).toBe(400);
    // Una llamada.
    expect(remoteCalls).toBe(1);
    // 200.
    expect(response.status).toBe(200);
    // Cuerpo.
    const body = (await response.json()) as {
      // Vectores.
      vectors: number[][];
      // Revisión.
      providerRevision: string | null;
    };
    // 32 dimensiones.
    expect(body.vectors[0]?.length).toBe(32);
    // Sin revisión.
    expect(body.providerRevision).toBeNull();
  });
});
