# Grafo CRAG

La etapa correctiva usa el `StateGraph` de LangGraph.js 1.4.18. La lógica de límites, escala de puntuaciones, umbrales, validación y audiencia está en `packages/rag/src/crag.ts`. El grafo y los adaptadores están en `apps/api/src/crag-graph.ts` y `apps/api/src/crag-real.ts` (y la versión de laboratorio sobre PostgreSQL/pgvector en `lab/src/crag-graph.ts`). El navegador no importa LangGraph.

Cada turno crea un estado nuevo. No hay checkpointer ni contadores compartidos entre conversaciones. La pregunta original (`originalQuestion`) no se sustituye por la consulta de búsqueda (`currentQuery`).

La inspiración es Shi-Qi Yan, Jia-Chen Gu, Yun Zhu y Zhen-Hua Ling, _Corrective Retrieval Augmented Generation_, arXiv:2401.15884. Esta aplicación adapta la idea al corpus cerrado del curso y al laboratorio de práctica: no busca en internet para inventar políticas internas ausentes.

```text
validar (validate)
  |-- calendario sin cohorte -> aclarar (clarify) -> fin
  |-- cancelado o sin tiempo -> error / abort -> fin
  \-- recuperar hasta 10 candidatos (retrieve)
        \-- reordenar en escala [0, 1] (rank)
              \-- valorar suficiencia y cobertura (assess)
                    |-- suficiente (sufficient) -> responder (answer) -> fin
                    |-- parcial / ambigua (partial) -> conservar útiles (retain) -> reformular (reformulate) -> retrieve
                    |-- insuficiente (insufficient) -> descartar contexto (discard) -> reformular (reformulate) -> retrieve
                    \-- límite agotado, sin progreso o salida inválida -> rechazo (refuse) o error -> fin
```

## Separación entre reordenamiento (`rank`) y valoración de suficiencia (`assess`)

El grafo separa explícitamente dos decisiones conceptuales y operativas en nodos distintos:

1. **Reordenamiento (`rank`, `validateRanking`)**:
   - Toma los fragmentos candidatos de la pasada actual unidos a los ya conservados (máximo 10 candidatos, sin duplicados).
   - Asigna a cada fragmento una puntuación `score` en la **escala cerrada `[0, 1]`** (`CRAG_SCORE_THRESHOLDS.minScore = 0`, `CRAG_SCORE_THRESHOLDS.maxScore = 1`) y un motivo breve.
   - Puede ejecutarse mediante un puerto dedicado `rerank` (por ejemplo con **Qwen3-Reranker-0.6B** usando su plantilla oficial `yes`/`no` o un reordenador dedicado) o compartir la llamada estructurada del evaluador (`rankAndAssess`) validando primero la ordenación en `rank` y después el juicio en `assess`.
   - La ordenación validada manda el orden del contexto final. Un empate de puntuación conserva la posición devuelta por el reordenador.

2. **Valoración de suficiencia (`assess`, `validateAssessment` / `assessCoverageByThresholds`)**:
   - Recibe el ranking ya validado y juzga si el conjunto de fragmentos útiles cubre **toda la pregunta original**, no solo si un fragmento aislado se parece a alguna palabra de la consulta.
   - **Relevancia de un fragmento ≠ cobertura de toda la pregunta**: un fragmento puede tener `score = 0.85` porque explica con exactitud el estado y los nodos de LangGraph (S5), pero si la pregunta pide _«¿Cómo modela LangGraph el estado de un agente y cómo se observa esa ejecución?»_, falta la mitad sobre observabilidad (S6). La relevancia individual del fragmento S5 es alta (`0.85 >= 0.50`), pero la cobertura de la pregunta completa es **parcial** (`0.50 < 0.75`), por lo que el grafo conserva S5 y reformula para buscar S6.

## Escala de puntuaciones `[0, 1]` y umbrales calibrados

Definidos en `CRAG_SCORE_THRESHOLDS` (`packages/rag/src/crag.ts`):

| Parámetro               |           Valor | Significado e interpretación                                                                                                                                                                                            |
| ----------------------- | --------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minScore` / `maxScore` | `0.00` – `1.00` | Dominio válido de `score`. Cualquier número fuera de `[0, 1]` o no finito se rechaza en validación. No es una probabilidad estadística de verdad, sino una señal acotada de relevancia documental frente a la consulta. |
| `minChunkRelevance`     |          `0.50` | Corte mínimo de relevancia individual para que un fragmento entre en `usefulIds` (máximo 6 fragmentos). Un fragmento con `< 0.50` se considera ruido o tangencial.                                                      |
| `partialCoverageMin`    |          `0.40` | Cobertura mínima global de la pregunta para declarar `partial` cuando existe al menos un fragmento útil (`>= 0.50`) pero quedan subpreguntas o aspectos sin cubrir en `gaps`.                                           |
| `sufficientCoverageMin` |          `0.75` | Cobertura mínima global de la pregunta (sin lagunas en `gaps`) para declarar `sufficient` y pasar a generar la respuesta.                                                                                               |

### Ejemplos de validación (distintos del conjunto reservado de 20 preguntas)

Los umbrales se calibraron sobre los seis escenarios de desarrollo (`corpus/fixtures/crag-development-cases.json`) y las pruebas dirigidas de `docs/crag-evaluador-gemini.md`, nunca sobre el conjunto reservado de test:

1. **Suficiente en primera búsqueda (`sufficient-s5`)**:
   - Pregunta: _«¿Cómo modela LangGraph un agente con estado y nodos?»_
   - Fragmento `s05-langgraph:00` obtiene `score = 0.91` (`>= 0.50`), cubre la única pregunta formulada (`cobertura >= 0.75`, `gaps = []`) → decisión `sufficient` → `answer`.
2. **Relevancia alta de fragmento pero cobertura parcial (`partial-s5-s6`)**:
   - Pregunta: _«¿Cómo modela LangGraph el estado de un agente y cómo se observa esa ejecución?»_
   - Pasada 1: `s05-langgraph:00` obtiene `score = 0.80` (`>= 0.50`), pero la cobertura global es `0.50` (`0.40 <= 0.50 < 0.75`) con `gaps = ["Falta cómo observar la ejecución del agente."]`. Decisión: `partial` → `retain` conserva S5 → `reformulate` genera _«observabilidad Langfuse y LangSmith de un agente»_.
   - Pasada 2: entra `s06-observabilidad:00` con `score = 0.86`; unidos `S6` y `S5` sin duplicados, la cobertura sube por encima de `0.75` sin lagunas → `sufficient` → `answer`.
3. **Evidencia inicial irrelevante (`irrelevant-then-s6`)**:
   - Pregunta: _«¿Qué cubre la sesión de observabilidad del programa?»_
   - Pasada 1: `s16-cloud-aws:00` obtiene `score = 0.20` (`< 0.50`), cobertura `< 0.40` → `insufficient` → `discard` descarta S16 → `reformulate` → Pasada 2 recupera S6 (`score = 0.88`) → `sufficient`.
4. **Dato inexistente y agotamiento del límite (`missing-info`)**:
   - Pregunta: _«¿Qué beca interna del año 1991 cubre este programa?»_
   - Tres búsquedas con `score = 0.10` (`< 0.50`) e `insufficient` en cada intento → tras 3 búsquedas y 2 reformulaciones termina en `refuse` con **0 llamadas al generador**.

## Límites por turno y garantías

- **3 búsquedas máximas** por turno (incluida la inicial) y **2 reformulaciones máximas**.
- **10 candidatos máximos** por búsqueda y **6 fragmentos útiles máximos** conservados en el contexto.
- **Plazo único de 20 segundos** por turno: cada llamada recibe el tiempo restante (`remainingBudgetMs`); un resultado tardío se descarta.
- Una petición fallida cuenta como intento; no hay reintentos ocultos (`maxRetries = 0`).
- La generación final usa el mismo modelo y política de citas verificables `[cite:id]` que el RAG básico.
