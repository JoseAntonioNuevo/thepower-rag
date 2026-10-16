# Checklist de preclase (S10 y S11)

Ejecútalo en el portátil desde el que vas a proyectar unos minutos antes de abrir la sesión.

## Común a S10 y S11

1. Directorio de trabajo: `/Users/jose/Documents/the-power/3-rag`.
2. Comprueba el estado local sin red:
   ```bash
   bun run preflight
   ```
   Debe terminar con código `0` y mostrar `APP_MODE efectivo: demo`. Si `.dev.vars` fija otro modo y quieres usar la demo offline, sigue `material/notas/incidencias-y-respaldo.md`.
3. Comprueba el laboratorio reproducible de PostgreSQL/pgvector (`lab/`):
   ```bash
   bun run lab:demo
   ```
   Debe reconstruir el índice `lab-689164ca81cd` (10 documentos ficticios de AetherCloud, 20 fragmentos, `768` dimensiones, índice HNSW `lab_chunks_embedding_hnsw_idx`) y mostrar en consola la respuesta citada, el rechazo sin generador, el reordenamiento `top-10`, la ruta parcial con 2 búsquedas y el corte a las 3 búsquedas.
4. Arranca el servidor local de respaldo en una pestaña de terminal:
   ```bash
   bun run dev
   ```
   Abre la URL impresa en `Local:` (por defecto `http://localhost:5173/`).
5. Si vas a mostrar también el asistente desplegado (`https://rag-thepower.josenuevo.dev`) o el perfil local real (`bun run dev:real`), recuerda lo indicado en `material/guiones/recorrido-cloud.md`:
   - Si enseñas el recorrido semántico (`RAG_CONTEXT_MODE=semantic`), señala el embedding BGE-M3 (`1024 d`), la puntuación de Vectorize y el corte `0,50`.
   - Si muestras la variante `RAG_CONTEXT_MODE=complete`, señala en la traza `complete-course-context-d1` y explica que carga los 49 fragmentos del grupo desde D1 sin filtro de coseno `0,50`.
6. Abre la presentación correspondiente (`S10-rag-basico.pptx` o `S11-crag.pptx`) en la diapositiva 1 y ten localizada `material/assets/qr-ai-engineer.jpg`.

## Específico de S10 (jueves 22 de octubre)

- Tener abiertos en el editor:
  - `packages/rag/src/chunk.ts` y `lab/src/corpus.ts` (fragmentación `900` caracteres y `80` de solapamiento).
  - `lab/schema.sql` (`CREATE EXTENSION vector`, `embedding vector(768) NOT NULL`, `USING hnsw (embedding vector_cosine_ops)`).
  - `apps/api/src/app.ts` (línea 670, recorrido semántico) y `lab/src/rag-basic.ts` (umbral previo y bloque `DATOS`).
  - `material/ejercicios/S10-enunciado.md`.

## Específico de S11 (martes 27 de octubre)

- Tener abiertos en el editor:
  - `packages/rag/src/crag.ts` (`CRAG_SCORE_THRESHOLDS`: escala `[0, 1]`, corte individual `0,50`, cobertura parcial `0,40` y suficiente `0,75`).
  - `apps/api/src/crag-graph.ts` y `lab/src/crag-graph.ts` (nodos separados `retrieve → rank/rerank → assess → retain/discard → reformulate → answer/refuse`).
  - `lab/src/reranker.ts` (`formatQwen3RerankerPrompt` y distinción entre relevancia de un fragmento y cobertura de la pregunta).
  - `lab/eval/resultados-laboratorio.md` y `material/comparacion/resultados/tabla-resultados.md` (tablas con recuperaciones medias).
  - `material/ejercicios/S11-enunciado.md`.
