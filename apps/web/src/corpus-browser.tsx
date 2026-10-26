// GUÍA DE LECTURA · apps/web/src/corpus-browser.tsx
// Biblioteca de documentos: lista los documentos del corpus del chat (la tienda) guardados en D1 y, al
// elegir uno, abre a su derecha sus fragmentos uno tras otro, tal como se guardaron (sección, tamaño,
// id y texto completo), con el solapamiento con el fragmento anterior resaltado. Cada lectura va a la
// base de datos en ese momento; «Actualizar» vuelve a leerla. En la demo enseña la tienda preparada.
// Hooks de React.
import { useEffect, useRef, useState } from "react";
// Esquemas y tipos de la biblioteca.
import {
  corpusChunksResponseSchema,
  corpusDocumentsResponseSchema,
  type CorpusChunksResponse,
  type CorpusDocumentsResponse,
  type CorpusKey,
} from "@thepower-rag/contracts";
// Lógica pura: solapamiento y formatos.
import { formatCount, formatReadTime, overlapWithPrevious } from "./corpus-view";
// Panel que se desliza al abrir un documento.
import { PanelSlide } from "./chat-motion-view";

// Mensaje cuando el navegador no llega al servidor (servidor parado, sin red o URL equivocada).
export const OFFLINE_MESSAGE =
  "No se pudo conectar con el servidor. Comprueba que la web sigue en marcha y pulsa Actualizar.";

// Lee una URL de la API y valida la respuesta con su esquema; lanza un error legible si falla.
async function readJson<T>(url: string, parse: (value: unknown) => T, signal: AbortSignal) {
  // Petición sin caché: es la base de datos en este momento. Un fallo de red («Failed to fetch»)
  // se traduce a un mensaje que diga qué hacer; una cancelación se propaga tal cual.
  const response = await fetch(url, { signal, cache: "no-store" }).catch((caught: unknown) => {
    if (signal.aborted) throw caught;
    throw new Error(OFFLINE_MESSAGE);
  });
  // Error HTTP con el mensaje del servidor.
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `La API respondió HTTP ${String(response.status)}.`);
  }
  // Cuerpo validado.
  return parse(await response.json());
}

// Origen de los datos para el pie de cada lectura.
function sourceLabel(source: "d1" | "fixture", readAt: string): string {
  // D1 real o corpus de prueba.
  return source === "d1"
    ? `Leído de D1 a las ${formatReadTime(readAt)}`
    : `Corpus preparado de la demo, sin D1 (${formatReadTime(readAt)})`;
}

// Pantalla de la biblioteca.
export function CorpusBrowser({ onClose }: { onClose: () => void }) {
  // Corpus elegido (null: el del chat, el primero que ofrece la API).
  const [corpus, setCorpus] = useState<CorpusKey | null>(null);
  // Documento abierto.
  const [documentId, setDocumentId] = useState<string | null>(null);
  // Columna de fragmentos, para bajar hasta ella cuando la pantalla es de una sola columna.
  const detailRef = useRef<HTMLDivElement>(null);
  // Contador de relecturas: «Actualizar» lo sube y las dos lecturas se repiten.
  const [reload, setReload] = useState(0);
  // Lista de documentos y su error.
  const [list, setList] = useState<CorpusDocumentsResponse | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // Fragmentos del documento abierto y su error.
  const [detail, setDetail] = useState<CorpusChunksResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Lee la lista de documentos del corpus elegido.
  useEffect(() => {
    // Cancela la lectura si cambia el corpus o se cierra la pantalla.
    const controller = new AbortController();
    // Consulta.
    const query = corpus === null ? "" : `?corpus=${encodeURIComponent(corpus)}`;
    readJson(
      `/api/corpus${query}`,
      (value) => corpusDocumentsResponseSchema.parse(value),
      controller.signal,
    )
      .then((body) => {
        // Lista y sin error.
        setList(body);
        setListError(null);
      })
      .catch((caught: unknown) => {
        // Cancelada: nada.
        if (controller.signal.aborted) return;
        // Error visible.
        setListError(caught instanceof Error ? caught.message : "No se pudo leer la lista.");
      });
    // Limpieza.
    return () => {
      controller.abort();
    };
  }, [corpus, reload]);

  // Corpus efectivo: el elegido o el que devolvió la API.
  const activeCorpus = corpus ?? list?.corpus.key ?? null;

  // Lee los fragmentos del documento abierto.
  useEffect(() => {
    // Sin documento o sin corpus, nada que leer.
    if (documentId === null || activeCorpus === null) {
      return;
    }
    // Cancela la lectura si cambia el documento.
    const controller = new AbortController();
    readJson(
      `/api/corpus/${encodeURIComponent(activeCorpus)}/${encodeURIComponent(documentId)}`,
      (value) => corpusChunksResponseSchema.parse(value),
      controller.signal,
    )
      .then((body) => {
        // Fragmentos y sin error.
        setDetail(body);
        setDetailError(null);
      })
      .catch((caught: unknown) => {
        // Cancelada: nada.
        if (controller.signal.aborted) return;
        // Error visible.
        setDetailError(caught instanceof Error ? caught.message : "No se pudo leer el documento.");
      });
    // Limpieza.
    return () => {
      controller.abort();
    };
  }, [activeCorpus, documentId, reload]);

  // Fragmentos visibles: solo los del documento abierto ahora.
  const shown = detail !== null && detail.document.documentId === documentId ? detail : null;

  // Pantalla.
  return (
    <section className="library" aria-label="Documentos y fragmentos de la base de datos">
      {/* Cabecera: título, origen de los datos y acciones. */}
      <div className="library-head">
        <div>
          <h2>Documentos y fragmentos en la base de datos</h2>
          <p className="library-note">
            {list !== null
              ? `${list.corpus.label} · ${sourceLabel(list.source, list.readAt)}`
              : listError !== null
                ? "Sin lectura: la última petición falló."
                : "Leyendo la base de datos…"}
          </p>
        </div>
        <div className="library-actions">
          {/* Vuelve a leer D1. */}
          <button
            type="button"
            className="class-button"
            onClick={() => {
              // Borra los errores y vuelve a leer.
              setListError(null);
              setDetailError(null);
              setReload((current) => current + 1);
            }}
          >
            Actualizar
          </button>
          {/* Vuelve al chat sin perder la conversación. */}
          <button type="button" onClick={onClose}>
            Volver al chat
          </button>
        </div>
      </div>
      {/* Selector de corpus si hay más de uno. */}
      {list !== null && list.corpora.length > 1 ? (
        <div className="library-corpora" role="group" aria-label="Corpus">
          {list.corpora.map((option) => (
            <button
              key={option.key}
              type="button"
              className="class-chip"
              data-state={option.key === activeCorpus ? "active" : "next"}
              aria-pressed={option.key === activeCorpus}
              onClick={() => {
                // Cambia de corpus y cierra el documento abierto.
                setCorpus(option.key);
                setDocumentId(null);
                setDetail(null);
                setList(null);
              }}
            >
              {option.label} · versión {option.version}
            </button>
          ))}
        </div>
      ) : null}
      {/* Error de la lista. */}
      {listError === null ? null : <p className="library-error">{listError}</p>}
      {/* Dos columnas: documentos y fragmentos del elegido. */}
      <div className="library-body">
        {/* Documentos. */}
        <nav className="library-list" aria-label="Documentos">
          {list === null ? (
            listError === null ? (
              <p className="library-note">Cargando documentos…</p>
            ) : null
          ) : (
            <ul>
              {list.documents.map((document) => (
                <li key={document.documentId}>
                  <button
                    type="button"
                    className="library-doc"
                    aria-current={document.documentId === documentId ? "true" : undefined}
                    onClick={() => {
                      // Abre el documento.
                      setDocumentId(document.documentId);
                      // En una sola columna, los fragmentos quedan debajo de la lista: baja hasta ellos.
                      if (window.matchMedia("(max-width: 799px)").matches) {
                        window.requestAnimationFrame(() => {
                          detailRef.current?.scrollIntoView({ block: "start" });
                        });
                      }
                    }}
                  >
                    {/* Título. */}
                    <span className="library-doc-title">
                      {document.title || document.documentId}
                    </span>
                    {/* Id y totales. */}
                    <span className="library-doc-meta">
                      {document.documentId} · {String(document.chunks)}{" "}
                      {document.chunks === 1 ? "fragmento" : "fragmentos"} ·{" "}
                      {formatCount(document.chars)} caracteres
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
        {/* Fragmentos del documento abierto. */}
        <div className="library-detail" ref={detailRef}>
          {documentId === null ? (
            <p className="library-note">
              Elige un documento para ver cómo se partió en fragmentos. Cada fragmento tiene como
              mucho 900 caracteres y lleva el nombre de su sección; si un párrafo no cabe, el
              siguiente fragmento repite los últimos caracteres del anterior (solapamiento).
            </p>
          ) : detailError !== null ? (
            <p className="library-error">{detailError}</p>
          ) : shown === null ? (
            <p className="library-note">Leyendo los fragmentos…</p>
          ) : (
            <PanelSlide key={shown.document.documentId}>
              {/* Documento y totales. */}
              <header className="library-doc-head">
                <h3>{shown.document.title || shown.document.documentId}</h3>
                <p className="library-note">
                  {shown.document.documentId} · grupo {shown.document.audience} ·{" "}
                  {String(shown.chunks.length)}{" "}
                  {shown.chunks.length === 1 ? "fragmento" : "fragmentos"} ·{" "}
                  {formatCount(shown.document.chars)} caracteres ·{" "}
                  {sourceLabel(shown.source, shown.readAt)}
                </p>
              </header>
              {/* Un fragmento tras otro. */}
              <ol className="library-chunks">
                {shown.chunks.map((chunk, index) => {
                  // Caracteres repetidos del fragmento anterior.
                  const overlap = overlapWithPrevious(
                    shown.chunks[index - 1]?.text ?? null,
                    chunk.text,
                  );
                  return (
                    <li key={chunk.chunkId} className="library-chunk">
                      {/* Cabecera del fragmento. */}
                      <div className="library-chunk-head">
                        <span className="library-chunk-title">
                          Fragmento {String(chunk.ordinal + 1)}
                          {chunk.section === "" ? "" : ` · ${chunk.section}`}
                        </span>
                        <span className="library-doc-meta">
                          {formatCount(chunk.chars)} caracteres
                          {overlap > 0 ? ` · repite ${String(overlap)} del anterior` : ""}
                        </span>
                      </div>
                      {/* Id técnico, tal como se cita y se guarda en Vectorize. */}
                      <code className="library-chunk-id">{chunk.chunkId}</code>
                      {/* Texto completo; el solapamiento, resaltado. */}
                      <p className="library-chunk-text">
                        {overlap > 0 ? (
                          <mark title="Texto repetido del fragmento anterior">
                            {chunk.text.slice(0, overlap)}
                          </mark>
                        ) : null}
                        {chunk.text.slice(overlap)}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </PanelSlide>
          )}
        </div>
      </div>
    </section>
  );
}
