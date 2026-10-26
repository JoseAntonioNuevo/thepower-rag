// GUÍA DE LECTURA · apps/api/src/corpus-browser.test.ts
// Pruebas de la biblioteca de documentos: qué corpus se ofrecen, lectura de D1 con dobles de las
// consultas, el corpus de prueba de la demo y las rutas HTTP con sus errores, sin red.
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Esquemas del contrato.
import {
  corpusChunksResponseSchema,
  corpusDocumentsResponseSchema,
  errorResponseSchema,
} from "@thepower-rag/contracts";
// App Hono.
import { createApp } from "./app";
// Funciones que se prueban.
import { corpusOptions, listChunks, listDocuments, type ReadDatabase } from "./corpus-browser";
// Entorno.
import type { WorkerEnv } from "./env";

// Doble de D1: devuelve filas según la consulta y anota los valores enlazados.
function fakeDatabase(rows: {
  documents: Record<string, unknown>[];
  chunks: Record<string, unknown>[];
}): ReadDatabase & { bound: unknown[][] } {
  // Valores enlazados en cada consulta.
  const bound: unknown[][] = [];
  return {
    bound,
    prepare: (query: string) => ({
      bind: (...values: unknown[]) => {
        bound.push(values);
        return {
          // Varias filas: fragmentos o documentos según la consulta.
          all: async <T>() => ({
            results: (query.startsWith("SELECT chunk_id") ? rows.chunks : rows.documents) as T[],
          }),
          // Una fila: el documento pedido, si existe.
          first: async <T>() =>
            (rows.documents.find((row) => row.documentId === values[1]) ?? null) as T | null,
        };
      },
    }),
  };
}

// Entorno real con la tienda en el chat.
const storeEnv: WorkerEnv = {
  APP_MODE: "real",
  CHAT_CORPUS: "thepower-shop",
  STORE_CORPUS_VERSION: "cc140d7876624",
  CORPUS_VERSION: "c3a59a406888b",
};

// Grupo.
describe("biblioteca de documentos", () => {
  // Solo se ofrece el corpus del chat: la tienda, nunca el curso a su lado.
  it("ofrece solo el corpus del chat", () => {
    // Tienda: solo ThePower Shop.
    expect(corpusOptions(storeEnv, false).map((item) => [item.key, item.version])).toEqual([
      ["thepower-shop", "cc140d7876624"],
    ]);
    // Curso en el chat: solo el curso.
    expect(
      corpusOptions({ APP_MODE: "real", CORPUS_VERSION: "c3a59a406888b" }, false).map(
        (item) => item.key,
      ),
    ).toEqual(["course"]);
    // Sin versión configurada no se ofrece nada.
    expect(corpusOptions({ ...storeEnv, STORE_CORPUS_VERSION: "replace-with-x" }, false)).toEqual(
      [],
    );
    // Demo: la tienda preparada.
    expect(corpusOptions({}, true)).toEqual([
      expect.objectContaining({ key: "thepower-shop", version: "cc140d7876624" }),
    ]);
  });

  // D1: documentos con sus totales, filtrando filas no válidas.
  it("lee los documentos de D1 por versión y descarta filas no válidas", async () => {
    // Doble con un documento válido y otro con grupo desconocido.
    const database = fakeDatabase({
      documents: [
        {
          documentId: "02-devoluciones",
          title: "Devoluciones",
          audience: "program",
          chunks: 7,
          chars: 2900,
        },
        { documentId: "raro", title: "Raro", audience: "otro", chunks: 1, chars: 10 },
      ],
      chunks: [],
    });
    // Opción y lectura.
    const options = corpusOptions(storeEnv, false);
    const body = await listDocuments({ option: options[0]!, options, database });
    // Cumple el contrato y solo trae el válido.
    expect(
      corpusDocumentsResponseSchema.parse(body).documents.map((item) => item.documentId),
    ).toEqual(["02-devoluciones"]);
    expect(body.source).toBe("d1");
    // Enlazó la versión de la tienda.
    expect(database.bound[0]).toEqual(["cc140d7876624"]);
  });

  // D1: fragmentos de un documento y documento inexistente.
  it("lee los fragmentos en orden y devuelve null si el documento no existe", async () => {
    // Doble con un documento y dos fragmentos.
    const database = fakeDatabase({
      documents: [
        {
          documentId: "02-devoluciones",
          title: "Devoluciones",
          audience: "program",
          chunks: 2,
          chars: 20,
        },
      ],
      chunks: [
        {
          chunkId: "cc140d7876624:02-devoluciones:00",
          ordinal: 0,
          section: "Plazo",
          text: "## Plazo",
        },
        {
          chunkId: "cc140d7876624:02-devoluciones:01",
          ordinal: 1,
          section: "Estado",
          text: "## Estado",
        },
      ],
    });
    // Opción de la tienda.
    const option = corpusOptions(storeEnv, false)[0]!;
    // Documento existente.
    const body = await listChunks({ option, documentId: "02-devoluciones", database });
    expect(corpusChunksResponseSchema.parse(body).chunks.map((item) => item.ordinal)).toEqual([
      0, 1,
    ]);
    expect(body?.chunks[0]?.chars).toBe(8);
    // Documento inexistente.
    expect(await listChunks({ option, documentId: "99-nada", database })).toBeNull();
  });

  // Demo: los 12 documentos de la tienda preparada, sin documentos del curso.
  it("en la demo enseña solo la tienda preparada", async () => {
    // Opciones de la demo.
    const options = corpusOptions({}, true);
    // Documentos.
    const documents = await listDocuments({ option: options[0]!, options, database: null });
    expect(documents.source).toBe("fixture");
    expect(documents.documents).toHaveLength(12);
    expect(documents.documents.some((item) => item.documentId.startsWith("s0"))).toBe(false);
    // Fragmentos de la política de devoluciones, en orden.
    const chunks = await listChunks({
      option: options[0]!,
      documentId: "02-devoluciones",
      database: null,
    });
    expect(chunks?.chunks.map((item) => item.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(chunks?.chunks[4]?.section).toBe("Reembolso de una devolución");
  });

  // Rutas HTTP: demo, errores de id, corpus y base de datos.
  it("responde por HTTP y rechaza ids, corpus o configuración no válidos", async () => {
    // App.
    const app = createApp();
    // Demo: lista y fragmentos.
    const list = await app.request("/api/corpus", {}, {});
    expect(list.status).toBe(200);
    expect(list.headers.get("cache-control")).toBe("no-store");
    const documents = corpusDocumentsResponseSchema.parse(await list.json());
    const id = documents.documents[0]!.documentId;
    const chunks = await app.request(`/api/corpus/thepower-shop/${id}`, {}, {});
    expect(corpusChunksResponseSchema.parse(await chunks.json()).document.documentId).toBe(id);
    // Id con caracteres no permitidos.
    const invalid = await app.request("/api/corpus/thepower-shop/..%2Fsecretos", {}, {});
    expect(invalid.status).toBe(400);
    expect(errorResponseSchema.parse(await invalid.json()).error).toBe("invalid_request");
    // El corpus del curso no se ofrece.
    expect((await app.request("/api/corpus?corpus=course", {}, {})).status).toBe(404);
    expect((await app.request(`/api/corpus/course/${id}`, {}, {})).status).toBe(404);
    // Documento que no existe.
    expect((await app.request("/api/corpus/thepower-shop/no-existe", {}, {})).status).toBe(404);
    // Real sin D1.
    const missing = await app.request("/api/corpus", {}, { ...storeEnv });
    expect(missing.status).toBe(409);
  });
});
