# Laboratorio reproducible S10 y S11 · PostgreSQL + pgvector (`vector(768)` + HNSW)

Este directorio acompaña al demostrador de aula (`apps/api`, `apps/web`) con un **laboratorio mínimo y completamente reproducible** que cumple literalmente todos los requisitos técnicos de los ejercicios publicados para **S10 (RAG básico)** y **S11 (Corrective RAG)**:

| Requisito del ejercicio publicado                                                  | Implementación en `lab/`                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ocho o más documentos ficticios en Markdown/TXT                                    | **10 documentos ficticios** de la plataforma sintética **AetherCloud** en `lab/corpus/sources/` (20 fragmentos con `maxChars = 900`, `overlapChars = 80`)                                                                                                                                                                                      |
| PostgreSQL con `pgvector`, columna `vector(768)` e índice HNSW                     | `lab/schema.sql` (`CREATE EXTENSION IF NOT EXISTS vector`, `embedding vector(768) NOT NULL`, `USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`) y `lab/docker-compose.yml`                                                                                                                                        |
| Variables de configuración de modelos y base de datos                              | `GEN_MODEL_ID` (por defecto `gemini-3.8-flash`), `EMBEDDING_MODEL_ID` (por defecto `gemini-embedding-2`, `768` dim.), `RERANKER_MODEL_ID` (`Qwen/Qwen3-Reranker-0.6B`), `EVALUATOR_MODEL_ID`, `DATABASE_URL`, `RAG_MIN_SIMILARITY`                                                                                                             |
| Reconstrucción completa desde documentos en bruto e índice vacío                   | `rebuildFromEmptyIndex()` en `lab/src/pgvector-store.ts`: ejecuta `TRUNCATE`, lee y limpia los 10 Markdown, trocea con solapamiento, genera vectores de 768 dimensiones, inserta y verifica el conteo de vuelta                                                                                                                                |
| S10: control de puntuación previo a generar y rechazo sin modelo                   | `runLabBasicRag()` en `lab/src/rag-basic.ts`: filtra por distancia coseno `<=> <= 0,75` (`similitud >= 0,25`, calibrado con los 6 casos de `LAB_VALIDATION_SET`); si no supera el corte, rechaza sin llamar al generador (`generationCalled: false`)                                                                                           |
| S11: grafo LangGraph con nodos separados y RAG básico conservado                   | `runLabCrag()` en `lab/src/crag-graph.ts`: `retrieve` (hasta 10 candidatos) → `rerank` (escala `[0, 1]`) → `assess` (suficiencia `sufficient` / `partial` / `insufficient` separando relevancia de un fragmento y cobertura total) → `retain` / `discard` → `reformulate` (máx. 2 reformulaciones, 3 búsquedas en total) → `answer` / `refuse` |
| Evaluación ejecutada sobre 20 preguntas nuevas (14 respondibles + 6 sin respuesta) | `runLabComparison20()` en `lab/src/evaluation.ts` y resultados guardados en `lab/eval/resultados-laboratorio.md`                                                                                                                                                                                                                               |

## Comandos rápidos

Desde la raíz del repositorio (`/Users/jose/Documents/the-power/3-rag`):

```bash
# 1. Reconstruir el índice de 768 dimensiones desde los 10 documentos en bruto (modo en memoria sin Docker)
bun run lab:rebuild

# 2. Recorrer la demostración de S10 (respuesta + rechazo) y S11 (parcial->suficiente + agotamiento de límite)
bun run lab:demo

# 3. Ejecutar la evaluación de 20 preguntas (14 respondibles + 6 sin respuesta) en RAG básico y CRAG
bun run lab:eval

# 4. Ejecutar los tests unitarios y de integración del laboratorio
bun run test scripts/lab-pgvector.test.ts
```

## Ejecución contra PostgreSQL 17 + `pgvector` real con Docker

Si dispones de Docker activo en tu máquina, puedes levantar la instancia PostgreSQL con `pgvector` y ejecutar exactamente el mismo flujo contra la tabla `lab_chunks` con columna `vector(768)` e índice HNSW:

```bash
docker compose -f lab/docker-compose.yml up -d
DATABASE_URL="postgresql://aether:aether_lab_2026@127.0.0.1:54329/aether_rag" bun scripts/lab-cli.ts rebuild --postgres
DATABASE_URL="postgresql://aether:aether_lab_2026@127.0.0.1:54329/aether_rag" bun scripts/lab-cli.ts demo --postgres
DATABASE_URL="postgresql://aether:aether_lab_2026@127.0.0.1:54329/aether_rag" bun scripts/lab-cli.ts eval --postgres
```

## Escala de puntuaciones y calibración de umbrales

1. **Distancia coseno (`<=>`) frente a similitud coseno en `pgvector`:**
   - En PostgreSQL con `pgvector`, el operador `<=>` devuelve **distancia coseno** en \([0, 2]\), donde **menor valor significa mayor proximidad** (`0` = vectores idénticos).
   - La consulta SQL calcula tanto `cosine_distance = (embedding <=> $1::vector(768))` como `similarity = (1 - (embedding <=> $1::vector(768)))`.
   - Sobre el conjunto de validación (`LAB_VALIDATION_SET`, 6 preguntas disjuntas del test de 20), la pregunta sin respuesta más cercana alcanzó `similitud = 0,148` (`distancia = 0,852`) y la respondible más baja `similitud = 0,250` (`distancia = 0,750`). El corte previo a generar quedó fijado en **`similitud >= 0,25` (`distancia <= 0,75`)**.

2. **Reordenamiento (`rerank`) frente a valoración de suficiencia (`assess`) en S11:**
   - El nodo `rerank` ordena hasta **10 candidatos** y les asigna `rerankScore` en la **escala cerrada `[0, 1]`** (incluye también `formatQwen3RerankerPrompt` con la plantilla oficial `yes`/`no` de `Qwen3-Reranker-0.6B`).
   - El nodo `assess` aplica dos criterios distintos:
     - **Relevancia individual del fragmento:** `rerankScore >= 0,50` para entrar en `usefulIds` (máximo 6 fragmentos).
     - **Cobertura global de la pregunta:** `coverageScore >= 0,75` sin lagunas → `sufficient`; `0,40 <= coverageScore < 0,75` o con laguna en `gaps` → `partial` (conserva útiles y reformula); `< 0,40` o sin fragmentos útiles → `insufficient` (descarta y reformula).
