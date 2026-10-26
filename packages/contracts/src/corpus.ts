// GUÍA DE LECTURA · packages/contracts/src/corpus.ts
// Contrato de la biblioteca de documentos: la lista de documentos de un corpus guardado en D1 y los
// fragmentos de uno de ellos en orden, tal como los lee la API en el momento. Lo usan la API y React.
// Zod valida las respuestas en el navegador.
import { z } from "zod";
// Grupo de un documento.
import { audienceSchema } from "./domain";

// Corpus que se puede consultar: el del chat y, si es otro, el del curso.
export const corpusKeySchema = z.enum(["course", "thepower-shop"]);

// Tipo de la clave de un corpus.
export type CorpusKey = z.infer<typeof corpusKeySchema>;

// Un corpus disponible con su nombre y versión.
export const corpusOptionSchema = z.object({
  key: corpusKeySchema,
  label: z.string().min(1).max(120),
  version: z.string().min(1).max(64),
});

// Un documento con cuántos fragmentos y caracteres tiene en la base de datos.
export const corpusDocumentSchema = z.object({
  documentId: z.string().min(1).max(128),
  title: z.string().max(240),
  audience: audienceSchema,
  chunks: z.number().int().min(0),
  chars: z.number().int().min(0),
});

// Tipo de un documento.
export type CorpusDocument = z.infer<typeof corpusDocumentSchema>;

// Lista de documentos de un corpus.
export const corpusDocumentsResponseSchema = z.object({
  // Corpus disponibles y el que se ha leído.
  corpora: z.array(corpusOptionSchema).min(1).max(2),
  corpus: corpusOptionSchema,
  // De dónde salen los datos: D1 real o el corpus de prueba de la demo.
  source: z.enum(["d1", "fixture"]),
  // Momento de la lectura.
  readAt: z.string().min(1).max(40),
  // Documentos en orden de id.
  documents: z.array(corpusDocumentSchema).max(200),
});

// Tipo de la lista de documentos.
export type CorpusDocumentsResponse = z.infer<typeof corpusDocumentsResponseSchema>;

// Un fragmento tal como está guardado: id, posición, sección y texto completo.
export const corpusChunkSchema = z.object({
  chunkId: z.string().min(1).max(128),
  ordinal: z.number().int().min(0),
  section: z.string().max(240),
  text: z.string().max(4000),
  chars: z.number().int().min(0),
});

// Tipo de un fragmento.
export type CorpusChunk = z.infer<typeof corpusChunkSchema>;

// Fragmentos de un documento, en orden.
export const corpusChunksResponseSchema = z.object({
  // Corpus leído.
  corpus: corpusOptionSchema,
  // Origen y momento de la lectura.
  source: z.enum(["d1", "fixture"]),
  readAt: z.string().min(1).max(40),
  // Documento y sus fragmentos.
  document: corpusDocumentSchema,
  chunks: z.array(corpusChunkSchema).max(200),
});

// Tipo de los fragmentos de un documento.
export type CorpusChunksResponse = z.infer<typeof corpusChunksResponseSchema>;
