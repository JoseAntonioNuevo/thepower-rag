> **S10:** la preparación vigente y los comandos reales están al principio de [S10-guion-profesor.md](../guiones/S10-guion-profesor.md). El QR se actualizó el 19/10. El recorrido offline descrito abajo es respaldo y no acredita modelos reales.

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
   Es el respaldo sin red. Desde el 24 de octubre reconstruye el índice `lab-ae3817b7bdcf` (12 políticas ficticias de Zocomar, 54 fragmentos, `768` dimensiones, índice HNSW `lab_chunks_embedding_hnsw_idx`) y muestra la respuesta citada, el rechazo sin generador, la ruta parcial simulada con 2 búsquedas y el corte a las 3 búsquedas. Sus reglas son léxicas: no miden modelos.
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

- Antes del directo: `bun run lab:real preflight` y `bun run lab:real status`; deben confirmar modelos reales, 768 dimensiones, 20 fragmentos y HNSW. El recorrido de `lab:demo` de arriba es solo respaldo.
- Ten localizados `lab/.local/calibration.json`, `material/S10/evidencias/evaluacion-real-resumen.md` y las copias JSON de `material/S10/evidencias/`. El test ya ejecutado se lee, no se repite en clase.
- Copia íntegros los bloques de cuatro líneas del guion para baseline y consultas: incluyen la asignación de la pregunta y las barras de continuación. Son los mismos que muestra el PowerPoint.

- Tener abiertos en el editor:
  - `packages/rag/src/chunk.ts` y `lab/src/corpus.ts` (fragmentación `900` caracteres y `80` de solapamiento).
  - `lab/schema.sql` (`CREATE EXTENSION vector`, `embedding vector(768) NOT NULL`, `USING hnsw (embedding vector_cosine_ops)`).
  - `apps/api/src/stores.ts` (`audienceFilter` y `queryVectorize`), `apps/api/src/lab-models.ts` (embeddings y generación reales) y `lab/src/rag-basic.ts` (`runLabBasicRag`, umbral previo y bloque `DATOS`).
  - `material/ejercicios/S10-enunciado.md`.

## Específico de S11 (martes 27 de octubre)

- Tener abiertos en el editor:
  - `packages/rag/src/crag.ts` (`CRAG_SCORE_THRESHOLDS`: escala `[0, 1]`, corte individual `0,50`, cobertura parcial `0,40` y suficiente `0,75`).
  - `apps/api/src/crag-graph.ts` y `lab/src/crag-graph.ts` (nodos separados `retrieve → rank/rerank → assess → retain/discard → reformulate → answer/refuse`).
  - `lab/src/reranker.ts` (`formatQwen3RerankerPrompt` y distinción entre relevancia de un fragmento y cobertura de la pregunta).
  - `apps/api/src/lab-models.ts` (juez y reformulador reales del laboratorio) y `lab/src/evaluation.ts` (validación, demostración y test de Zocomar).
  - `docs/evidence/zocomar-lab-2026-10-24.md` (resultado real: empate 14/14 y 6/6, margen 0,014 frente a 0,65, contexto limpio y coste).
  - `material/ejercicios/S11-enunciado.md`.
- Antes del directo, sin coste: `docker compose -f lab/docker-compose.yml up -d`, `bun run lab:real preflight` y `bun run lab:real status` (54 vectores de 768 dimensiones y HNSW). El diario `lab/.local/zocomar` tiene un tope autorizado de 5 USD y 2,7741628 USD reservados tras el ensayo del 24/10.
- La presentación de S11 no se ha actualizado con Zocomar: las diapositivas 4, 13 y 15 muestran datos anteriores. Sigue las indicaciones del guion para esas tres.
