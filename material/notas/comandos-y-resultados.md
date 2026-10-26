# Comandos y resultados verificados

Comandos locales de verificación, demostración y laboratorio medidos en `/Users/jose/Documents/the-power/3-rag` sin llamadas de pago.

## 1. Diagnóstico, calidad de código y batería de tests

| Comando             | Código | Resultado verificado                                                                                                                                                                             |
| ------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run check`     |    `0` | Formato (`vp fmt`), lint con tipos y comprobación estricta de TypeScript en `apps/`, `packages/`, `scripts/` y `lab/`.                                                                           |
| `bun run test`      |    `0` | Batería completa de pruebas unitarias y de grafos en verde (incluidos los validadores de escala `[0, 1]`, los nodos separados `rank` y `assess` y el laboratorio `pgvector` de 768 dimensiones). |
| `bun run preflight` |    `0` | `APP_MODE efectivo: demo`, sin RAG `offline-demo`, RAG y CRAG `offline-fixture`.                                                                                                                 |
| `bun run build`     |    `0` | Compila el frontend React y el bundle del Worker de Cloudflare sin errores.                                                                                                                      |

## 2. Comandos del laboratorio reproducible S10 y S11 (`lab/`)

| Comando                                             | Código | Qué ejecuta y qué imprime                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run lab:real eval --execute --max-spend-usd 5` |    `0` | **Ejecución real del 24/10/2026 sobre ThePower Shop** (12 políticas, 54 fragmentos): RAG `14/14` y `6/6`, CRAG `14/14` y `6/6`, `1,00` frente a `1,60` búsquedas medias, mediana `3,2 s` frente a `8,9 s` en respondibles. Recibos en `docs/evidence/thepower-shop-2026-10-24/`.                                                                                                                               |
| `bun run lab:rebuild`                               |    `0` | (Medición anterior al 24/10, con AetherCloud.) Vacía el índice y lo reconstruye desde los **10 documentos ficticios de AetherCloud** (`lab/corpus/sources/`): versión `lab-689164ca81cd`, `10` documentos, `20` fragmentos (`900/80`), `768` dimensiones e índice HNSW `lab_chunks_embedding_hnsw_idx (vector_cosine_ops)`.                                                                                    |
| `bun run lab:demo`                                  |    `0` | Ejecuta 5 casos: 1) S10 respuesta con cita `04-almacenamiento-y-cifrado-kms:00`; 2) S10 rechazo previo sobre Windows Server (`gen=false`); 3) S11 CRAG suficiente tras `rerank` sobre `top-10`; 4) S11 CRAG parcial con 2 búsquedas y 1 reformulación (`retrieve->rerank->assess->retain->reformulate->retrieve->rerank->assess->answer`); 5) S11 CRAG agotando 3 búsquedas y 2 reformulaciones (`gen=false`). |
| `bun run lab:eval`                                  |    `0` | Ejecuta las **20 preguntas nuevas de test (14 respondibles + 6 sin respuesta)** en RAG básico y CRAG y escribe `lab/eval/resultados-laboratorio.md`: **RAG `16/20` (`10/14` respondibles, `6/6` rechazos, `1,00` búsquedas medias)** frente a **CRAG `17/20` (`11/14` respondibles, `6/6` rechazos, `1,80` búsquedas medias)**.                                                                                |

## 3. Comandos del demostrador web en modo `demo` (`bun run dev`)

Con `bun run dev` levantado en `http://localhost:5173/`:

| Etapa y caso                                                             | Audiencia | Resultado en el demostrador local                                                                              |
| ------------------------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------- |
| **Sin RAG** · _«¿Cómo modela LangGraph un agente con estado y nodos?»_   | `program` | Stream `offline-demo` sin fuentes; uso y coste `no medido`.                                                    |
| **RAG básico** · _«¿Cuándo es la clase de RAG?»_                         | `program` | `clarify`: pide elegir el grupo `L/X` o `M/J` sin buscar ni llamar al modelo.                                  |
| **RAG básico** · _«¿Cuándo es la clase de RAG S10?»_                     | `M/J`     | Cita `c3a59a406888b:calendario-mj:10` y devuelve `2026-10-22`.                                                 |
| **RAG básico** · _«¿Qué beca interna del año 1991 cubre este programa?»_ | `program` | `refuse`: no supera el umbral y rechaza sin llamar al modelo.                                                  |
| **CRAG** · `sufficient-s5`                                               | `program` | 1 búsqueda, pasos `retrieve → rank → assess → answer`, cita `s05-langgraph:00`.                                |
| **CRAG** · `partial-s5-s6`                                               | `program` | 2 búsquedas, 1 reformulación, conserva S5 (`0,800`), une S6 (`0,860`) sin duplicar y responde con ambas citas. |
| **CRAG** · `irrelevant-then-s6`                                          | `program` | 2 búsquedas, 1 reformulación, descarta S16 (`0,200`) en el intento 1 y responde solo con S6 (`0,880`).         |
| **CRAG** · `missing-info` (beca de 1991)                                 | `program` | 3 búsquedas, 2 reformulaciones, generación `0` y final `refuse`.                                               |
| **CRAG** · `evaluator-error`                                             | `program` | Salida inválida detectada por `validateRanking` / `validateAssessment`; termina en `error` sin reintentos.     |
