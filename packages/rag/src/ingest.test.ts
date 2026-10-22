// GUÍA DE LECTURA · packages/rag/src/ingest.test.ts
// Pruebas de la ingesta con puertos en memoria (sin Cloudflare): manifiestos por perfil, visibilidad
// pendiente sin reinsertar, perfil activo intacto, fallos distinguibles y SQL sin inyección.
// Utilidades de prueba.
import { describe, expect, it } from "vite-plus/test";
// Claves de R2.
import { contentManifestKey, indexConfigReceiptKey, profileManifestKey } from "./ids";
// Funciones y tipos de la ingesta.
import {
  applyActiveSelection,
  runIngestion,
  type CatalogSnapshot,
  type CorpusManifest,
  type IngestJournalItem,
  type IngestPorts,
  type VisibleVector,
} from "./ingest";
// SQL de selección del perfil y escape de literales.
import { activeSelectionSql, sqlLiteral } from "./sql";

// Manifiesto de prueba con un documento y dos fragmentos de dimensión 2.
function manifest(profileId = "p0123456789ab"): CorpusManifest {
  // Manifiesto completo.
  return {
    // Manifiesto de perfil con ids de 13 caracteres como los reales.
    kind: "profile",
    contentVersion: "c0123456789ab",
    preparationId: "c0123456789ab",
    verifiedDate: "2026-10-03",
    profileId,
    // Perfil BGE-M3 de solo 2 dimensiones para que los vectores de la prueba sean cortos.
    embeddingModel: "@cf/baai/bge-m3",
    dimensions: 2,
    metric: "cosine",
    family: "workers-ai",
    providerRevision: null,
    // Troceado real: 900 caracteres con 80 de solapamiento.
    chunkMaxChars: 900,
    chunkOverlap: 80,
    contentManifestKey: contentManifestKey("c0123456789ab"),
    // Un documento del programa.
    documents: [
      {
        id: "nota",
        title: "Nota",
        audience: "program",
        session: "S1",
        sourcePath: "nota.md",
        sourceHash: "abc",
        body: "# Nota\n\nTexto de prueba.",
      },
    ],
    // Dos fragmentos del documento; el id del vector coincide con el del fragmento.
    chunks: [
      {
        chunkId: "c0123456789ab:nota:00",
        vectorId: "c0123456789ab:nota:00",
        documentId: "nota",
        section: "Nota",
        text: "Texto de prueba.",
        ordinal: 0,
      },
      {
        chunkId: "c0123456789ab:nota:01",
        vectorId: "c0123456789ab:nota:01",
        documentId: "nota",
        section: "Nota",
        text: "Segundo fragmento.",
        ordinal: 1,
      },
    ],
    remoteRevision: null,
  };
}

// Puertos en memoria que imitan R2, D1 y Vectorize; las opciones simulan fallos.
function ports(options?: {
  // Hace fallar la escritura del documento.
  fail?: boolean;
  // Índices de metadatos existentes.
  indexes?: string[];
  // false: los vectores no se ven todavía.
  visible?: boolean;
  // Métrica que informa el índice.
  metric?: string | null;
  // Dimensiones que informa el índice.
  dimensions?: number | null;
  // Recuento de vectores que informa el índice.
  vectorCount?: number | null;
  // Devuelve ids distintos de los escritos.
  wrongIds?: boolean;
  // Se llama al insertar vectores.
  onUpsert?: () => void;
  // Se llama al leerlos.
  onRead?: () => void;
}): IngestPorts & { objects: Map<string, string>; persisted: IngestJournalItem[] } {
  // Objetos de R2 en memoria.
  const objects = new Map<string, string>();
  // Metadatos de los vectores guardados.
  const stored = new Map<string, VisibleVector["metadata"]>();
  // Diario persistido.
  const persisted: IngestJournalItem[] = [];
  // Catálogo de D1 en memoria.
  let catalog: CatalogSnapshot | null = null;
  // Contador de mutaciones.
  let mutations = 0;
  // Manifiesto de referencia.
  const current = manifest();
  // Implementación en memoria de cada puerto.
  return {
    objects,
    persisted,
    // Doble de prueba: lee el objeto del corpus que necesita la ingesta o su comprobación posterior.
    getObject: async (key) => objects.get(key) ?? null,
    // Doble de prueba: escribe un objeto del corpus y entrega el resultado de almacenamiento a la ingesta.
    putObject: async (key, body) => {
      // Fallo provocado al escribir el documento.
      if (options?.fail === true && key.endsWith("nota.md")) {
        // Error de prueba.
        throw new Error("fallo de prueba");
      }
      // Guarda el objeto.
      objects.set(key, body);
    },
    // Doble de prueba: guarda en el catálogo los documentos y fragmentos de esta versión del corpus.
    writeCatalog: async (written) => {
      // Guarda el catálogo tal como lo devolvería D1.
      catalog = {
        // Documentos con los campos que lee D1.
        documents: written.documents.map((document) => ({
          id: document.id,
          title: document.title,
          audience: document.audience,
          sourceHash: document.sourceHash,
        })),
        // Fragmentos con su texto y orden.
        chunks: written.chunks.map((chunk) => ({
          chunkId: chunk.chunkId,
          documentId: chunk.documentId,
          text: chunk.text,
          ordinal: chunk.ordinal,
        })),
        // Mapa vector → fragmento.
        mappings: written.chunks.map((chunk) => ({
          vectorId: chunk.vectorId,
          chunkId: chunk.chunkId,
        })),
      };
    },
    // Doble de prueba: lee el catálogo para comprobar que los datos escritos coinciden con lo esperado.
    readCatalog: async () => catalog,
    // Doble de prueba: entrega los índices de metadatos para comprobar los filtros disponibles.
    listMetadataIndexes: async () => options?.indexes ?? ["corpusVersion", "audience", "profileId"],
    // Doble de prueba: inserta o actualiza vectores por identificador durante la ingesta.
    upsertVectors: async (batch) => {
      // Avisa de la inserción.
      options?.onUpsert?.();
      // Nueva mutación.
      mutations += 1;
      // Guarda los metadatos de cada vector.
      for (const vector of batch) {
        // Por id.
        stored.set(vector.id, vector.metadata);
      }
      // Id de mutación.
      return { mutationId: `mut-${String(mutations)}` };
    },
    // Doble de prueba: lee de vuelta los vectores para verificar su presencia e identidad después de escribirlos.
    readVectors: async (ids) => {
      // Avisa de la lectura.
      options?.onRead?.();
      // Vectores aún no visibles.
      if (options?.visible === false) {
        // Lista vacía.
        return [];
      }
      // Ids cambiados.
      if (options?.wrongIds === true) {
        // Devuelve ids ajenos.
        return ids.map((id) => ({ id: `otro-${id}`, metadata: stored.get(id) ?? null }));
      }
      // Devuelve los que existen.
      return ids
        .filter((id) => stored.has(id))
        .map((id) => ({ id, metadata: stored.get(id) ?? null }));
    },
    // Doble de prueba: entrega la descripción del índice que usa la comprobación de compatibilidad.
    describeIndex: async () => ({
      // Configuración del índice: nombre, dimensión y métrica, ajustables por cada prueba.
      name: "thepower-ai-course-rag-0123456789ab",
      dimensions: options?.dimensions === undefined ? current.dimensions : options.dimensions,
      metric: options?.metric === undefined ? "cosine" : options.metric,
      // Vectores visibles: los guardados, 0 si se simula visibilidad tardía o un valor forzado.
      vectorCount:
        options?.vectorCount === undefined
          ? options?.visible === false
            ? 0
            : stored.size
          : options.vectorCount,
    }),
    // Doble de prueba: guarda el progreso de ingesta para poder reanudar sin repetir pasos ya confirmados.
    persistJournal: async (item) => {
      // Guarda la anotación.
      persisted.push(item);
    },
    // Doble de prueba: registra la fase alcanzada para explicar el progreso y los fallos de la ingesta.
    recordPhase: async () => undefined,
  };
}

// Grupo de pruebas de la ingesta.
describe("ingesta", () => {
  // Ingesta completa: manifiesto por perfil, contenido común y recibo del índice.
  it("escribe manifiestos distintos y solo queda lista con lectura de vuelta", async () => {
    // Manifiesto.
    const current = manifest();
    // Puertos en memoria.
    const memory = ports();
    // Ingesta con dos vectores.
    const result = await runIngestion({
      manifest: current,
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      ports: memory,
    });
    // Termina lista.
    expect(result.phase).toBe("ready");
    // Clave del manifiesto del perfil.
    const profileKey = profileManifestKey(current.preparationId, current.profileId);
    // Manifiesto guardado.
    const body = memory.objects.get(profileKey) ?? "";
    // Incluye el perfil.
    expect(body).toContain(current.profileId);
    // No es solo la versión.
    expect(body).not.toBe(current.preparationId);
    // No hay un manifiesto común sin perfil.
    expect(memory.objects.has(`corpus/${current.preparationId}/manifest.json`)).toBe(false);
    // Manifiesto de contenido guardado.
    expect(memory.objects.get(contentManifestKey(current.preparationId))).toContain(
      '"kind":"content"',
    );
    // Recibo con la métrica observada.
    expect(
      memory.objects.get(indexConfigReceiptKey(current.preparationId, current.profileId)),
    ).toContain('"metric":"cosine"');
    // El catálogo quedó anotado como correcto.
    expect(memory.persisted.some((item) => item.key === "catalog" && item.ok)).toBe(true);
  });

  // Dos perfiles del mismo contenido no se pisan.
  it("no pisa el manifiesto de otro perfil del mismo contenido", async () => {
    // Primer perfil.
    const first = manifest("p0123456789ab");
    // Segundo perfil.
    const second = manifest("pba9876543210");
    // Con otra dimensión.
    second.dimensions = 4;
    // Mismo modelo.
    second.embeddingModel = "@cf/baai/bge-m3";
    // Mismos puertos.
    const memory = ports();
    // Ingesta del primero.
    await runIngestion({
      manifest: first,
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      ports: memory,
    });
    // Manifiesto del primero.
    const firstBody = memory.objects.get(profileManifestKey(first.preparationId, first.profileId));
    // Manifiesto de contenido.
    const content = memory.objects.get(contentManifestKey(first.preparationId));
    // Ingesta del segundo con su propio índice.
    await runIngestion({
      // Segundo perfil del mismo corpus, con vectores de 4 dimensiones.
      manifest: second,
      vectors: [
        [0.1, 0.2, 0.3, 0.4],
        [0.2, 0.2, 0.2, 0.2],
      ],
      ports: {
        ...memory,
        // Su índice tiene 4 dimensiones: no se mezcla con el del primer perfil.
        describeIndex: async () => ({
          name: null,
          dimensions: 4,
          metric: "cosine",
          vectorCount: 2,
        }),
      },
    });
    // El manifiesto del primero no cambió.
    expect(memory.objects.get(profileManifestKey(first.preparationId, first.profileId))).toBe(
      firstBody,
    );
    // El de contenido tampoco.
    expect(memory.objects.get(contentManifestKey(first.preparationId))).toBe(content);
    // El segundo tiene su propio manifiesto.
    expect(
      memory.objects.get(profileManifestKey(second.preparationId, second.profileId)),
    ).toContain(second.profileId);
  });

  // Sin visibilidad queda pendiente; al reanudar no se reinserta.
  it("deja la visibilidad pendiente y la siguiente lectura no reinserta", async () => {
    // Manifiesto.
    const current = manifest();
    // Si los vectores ya se ven.
    let visible = false;
    // Inserciones hechas.
    let upserts = 0;
    // Puertos con vectores invisibles.
    const memory = ports({
      visible: false,
      metric: null,
      dimensions: null,
      vectorCount: 0,
      // Observa la escritura del lote de vectores en el punto que comprueba esta prueba.
      onUpsert: () => {
        // Cuenta la inserción.
        upserts += 1;
      },
    });
    // Primera ingesta.
    const waiting = await runIngestion({
      manifest: current,
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      ports: memory,
      upsertBatchSize: 1,
    });
    // Pendiente de visibilidad.
    expect(waiting.phase).toBe("pending-visibility");
    // Sin fallos.
    expect(waiting.journal.some((item) => item.outcome === "failed")).toBe(false);
    // Dos lotes insertados.
    expect(upserts).toBe(2);
    // Mutaciones anotadas.
    const mutations = waiting.journal
      .filter((item) => item.key.startsWith("vectors:batch:"))
      .map((item) => item.mutationId);
    // Una por lote.
    expect(mutations).toEqual(["mut-1", "mut-2"]);
    // Ahora los vectores se ven.
    visible = true;
    // Reanuda con el diario anterior.
    const resumed = await runIngestion({
      manifest: current,
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      journal: waiting.journal,
      ports: {
        ...memory,
        // Doble de prueba: lee de vuelta los vectores para verificar su presencia e identidad después de escribirlos.
        readVectors: async (ids) => {
          // Solo se lee cuando ya son visibles.
          expect(visible).toBe(true);
          // Devuelve los vectores con sus metadatos.
          return ids.map((id) => ({
            // Cada vector vuelve con sus metadatos de versión, grupo y perfil.
            id,
            metadata: {
              corpusVersion: current.preparationId,
              audience: "program",
              profileId: current.profileId,
            },
          }));
        },
        // Índice coherente con el manifiesto.
        describeIndex: async () => ({
          name: null,
          dimensions: 2,
          metric: "cosine",
          vectorCount: 2,
        }),
      },
      // Lotes de un vector para probar la reanudación lote a lote.
      upsertBatchSize: 1,
    });
    // Queda lista.
    expect(resumed.phase).toBe("ready");
    // Sin nuevas inserciones.
    expect(upserts).toBe(2);
  });

  // Con el perfil activo no se escribe nada al consultar el estado.
  it("un perfil activo no se reescribe al consultar el estado", async () => {
    // Escrituras.
    let writes = 0;
    // Fases guardadas.
    let phases = 0;
    // Puertos en memoria.
    const memory = ports();
    // Ingesta marcada como activa.
    const result = await runIngestion({
      // Manifiesto y vectores normales.
      manifest: manifest(),
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      // Diario con una anotación previa ya correcta.
      journal: [
        {
          store: "r2",
          versionId: "c0123456789ab",
          profileId: "p0123456789ab",
          key: "ya",
          outcome: "succeeded",
          ok: true,
          error: null,
          mutationId: null,
        },
      ],
      // Escribir en R2 no debe ocurrir: el perfil activo no se toca.
      ports: {
        ...memory,
        // Doble de prueba: escribe un objeto del corpus y entrega el resultado de almacenamiento a la ingesta.
        putObject: async () => {
          // Cuenta escrituras.
          writes += 1;
        },
        // Doble de prueba: registra la fase alcanzada para explicar el progreso y los fallos de la ingesta.
        recordPhase: async () => {
          // Cuenta fases.
          phases += 1;
        },
      },
      profileIsActive: true,
    });
    // Ninguna escritura.
    expect(writes).toBe(0);
    // Ninguna fase guardada.
    expect(phases).toBe(0);
    // No se marca lista.
    expect(result.phase).not.toBe("ready");
  });

  // Un fallo de escritura se distingue de un corpus vacío y no toca otra versión.
  it("distingue un fallo de un resultado vacío y no toca otra versión", async () => {
    // Manifiesto.
    const current = manifest();
    // Puertos que fallan al escribir el documento.
    const memory = ports({ fail: true });
    // Objeto de otra versión.
    memory.objects.set("corpus/otra/documents/nota.md", "version anterior");
    // Ingesta que falla.
    const failed = await runIngestion({
      manifest: current,
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      ports: memory,
    });
    // Fallida.
    expect(failed.phase).toBe("failed");
    // Con el error de escritura.
    expect(
      failed.journal.some((item) => item.outcome === "failed" && item.error === "r2-write-failed"),
    ).toBe(true);
    // La otra versión sigue intacta.
    expect(memory.objects.get("corpus/otra/documents/nota.md")).toBe("version anterior");
    // Manifiesto vacío.
    const empty = manifest();
    // Sin documentos.
    empty.documents = [];
    // Sin fragmentos.
    empty.chunks = [];
    // Ingesta vacía.
    const blank = await runIngestion({ manifest: empty, vectors: [], ports: ports() });
    // También fallida.
    expect(blank.phase).toBe("failed");
  });

  // Sin índices de metadatos no se insertan vectores.
  it("no inserta vectores si faltan los índices de metadatos", async () => {
    // Inserciones.
    let upserts = 0;
    // Puertos sin índices.
    const memory = ports({
      indexes: [],
      // Observa la escritura del lote de vectores en el punto que comprueba esta prueba.
      onUpsert: () => {
        // Cuenta inserciones.
        upserts += 1;
      },
    });
    // Ingesta.
    const result = await runIngestion({
      manifest: manifest(),
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      ports: memory,
    });
    // Ninguna inserción.
    expect(upserts).toBe(0);
    // Fallida.
    expect(result.phase).toBe("failed");
    // Con su error.
    expect(result.journal.some((item) => item.error === "metadata-indexes-missing")).toBe(true);
  });

  // Métrica distinta y ids ajenos hacen fallar la ingesta.
  it("rechaza métrica distinta, metadatos incongruentes y un recuento que no identifica", async () => {
    // Índice con métrica euclidiana.
    const metric = await runIngestion({
      manifest: manifest(),
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      ports: ports({ metric: "euclidean" }),
    });
    // Fallida.
    expect(metric.phase).toBe("failed");
    // Por la métrica.
    expect(metric.journal.some((item) => item.error === "index-metric-mismatch")).toBe(true);
    // Índice que devuelve otros ids.
    const mismatch = await runIngestion({
      manifest: manifest(),
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      ports: ports({ wrongIds: true, vectorCount: 2 }),
    });
    // Fallida.
    expect(mismatch.phase).toBe("failed");
    // Por los ids.
    expect(mismatch.journal.some((item) => item.error === "vectorize-id-mismatch")).toBe(true);
  });

  // Un perfil no listo no sustituye al activo; el SQL escapa las comillas.
  it("conserva el perfil activo si el pedido no está listo", () => {
    // Perfil activo listo y otro fallido.
    const profiles = [
      { id: "p0123456789ab", status: "ready" as const, active: true },
      { id: "pba9876543210", status: "failed" as const, active: false },
    ];
    // Pedir el fallido no cambia nada.
    expect(applyActiveSelection(profiles, "pba9876543210")).toEqual(profiles);
    // SQL de selección.
    const sql = activeSelectionSql("pba9876543210");
    // Exige estado ready.
    expect(sql).toContain("status = 'ready'");
    // No borra nada.
    expect(sql).not.toContain("DELETE");
    // Las comillas se duplican: la inyección queda dentro del literal.
    expect(sqlLiteral("'); DROP TABLE documents; --")).toBe("'''); DROP TABLE documents; --'");
  });
});
