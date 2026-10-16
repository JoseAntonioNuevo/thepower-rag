# Recorrido del profesor en la aplicación real y el laboratorio reproducible

URL pública: https://rag-thepower.josenuevo.dev · Perfil local real: `bun run dev:real` (`apps/web/wrangler.jsonc`) · Laboratorio pgvector del ejercicio: `lab/` (`bun run lab:demo` y `bun run lab:eval`).

## Configuración de modelos y modos de recuperación

- **Proveedor y modelos en el checkout actual (`apps/web/wrangler.jsonc`):** `LLM_PROVIDER=anthropic`, `MODEL_ID=claude-haiku-5-5` y `EVALUATOR_MODEL_ID=claude-haiku-5-5` con `effort: low`. _(Nota histórica: las pruebas iniciales del 3 de octubre se ejecutaron con OpenRouter usando `openai/gpt-6-luna` y `google/gemini-3.8-flash`; sus recibos en `docs/crag-evaluador-gemini.md` y `comparacion/resultados/tabla-resultados.md` se conservan etiquetados como históricos)._
- **Referencia principal de S10 (`RAG_CONTEXT_MODE=semantic`):** en `apps/web/wrangler.jsonc` el modo configurado es `semantic` (`apps/api/src/app.ts:670`). En este modo, cada consulta se embebe con `@cf/baai/bge-m3` (`1024` dimensiones), busca vecinos en Vectorize (`p76509a5f9743`) filtrando por audiencia, aplica el umbral calibrado `0,50` y **rechaza antes de llamar al modelo** cuando ningún fragmento supera el corte.
- **Variante de contexto completo (`RAG_CONTEXT_MODE=complete`):** cuando se activa `complete` (`apps/api/src/course-context.ts`), se leen de D1 todos los fragmentos autorizados del grupo (`~23 000` caracteres) sin calcular embedding de la pregunta ni aplicar el filtro de similitud `0,50`. **Importante en directo:** si enseñas el bundle publicado antes de redesplegar y la traza muestra `complete-course-context-d1`, explica que esa variante carga el corpus entero por su pequeño tamaño y **no digas que está ejecutando el corte de coseno `0,50`**. Para mostrar en vivo la selección por puntuación y el rechazo previo a generar, usa el recorrido semántico (`RAG_CONTEXT_MODE=semantic`) y el laboratorio `lab/` (`bun run lab:demo`).

---

## S10: Sin RAG, recorrido semántico principal y variante de contexto completo

1. **Sin documentos (`Sin RAG`):**
   - Selecciona **Sin RAG**. Pregunta: _«¿En qué fecha exacta del grupo M/J se imparte la sesión S10 del programa AI Engineer de The Power?»_.
   - El modelo (`claude-haiku-5-5`) explica que no dispone del calendario interno del curso. No hay fuentes ni recuperación.
2. **Recorrido semántico principal (`RAG_CONTEXT_MODE=semantic` y `lab/`):**
   - Selecciona **RAG básico** y el grupo con clases los **martes y jueves (`M/J`)**.
   - Pregunta: _«¿Cómo modela LangGraph un agente con estado y nodos?»_.
   - Abre el panel **Fuentes** y **Traza de la clase**: enseña el embedding de la consulta (`@cf/baai/bge-m3`, 1024 d), los candidatos recuperados de Vectorize, sus puntuaciones de similitud coseno, el corte `0,50`, los fragmentos que entran en el bloque `DATOS` y la cita `[cite:c3a59a406888b:s05-langgraph:00]`.
3. **Pregunta rechazada por el control previo (sin llamar al generador):**
   - Pregunta: _«¿Qué beca interna del año 1991 cubre este programa?»_.
   - En el recorrido semántico (`RAG_CONTEXT_MODE=semantic`) y en el laboratorio (`bun run lab:demo`), ningún candidato supera el umbral (`0,50` en BGE-M3; `0,25` en el laboratorio `vector(768)`), por lo que el sistema devuelve `decision: "refuse"` y `generation: "skipped"` **sin llamar al modelo generativo**.
4. **Filtro de audiencia y aclaración sin gasto:**
   - Cambia el grupo a **General (`program`)** y pregunta: _«¿Cuándo es la clase de RAG?»_.
   - El sistema pide elegir grupo (`L/X` o `M/J`) sin embeber ni llamar al modelo.
5. **Variante de contexto completo (`RAG_CONTEXT_MODE=complete`):**
   - Presenta después `apps/api/src/course-context.ts` y `docs/rag-contexto-completo.md` como una **variante de ingeniería** útil únicamente cuando todo el corpus verificado cabe holgadamente en la ventana (máximo 200 fragmentos y 32 000 caracteres), explicando por qué el ejercicio de S10 exige el recorrido semántico con umbral previo y no cargar toda la base de datos en el prompt.
6. **Laboratorio reproducible del ejercicio (`lab/`):**
   - Ejecuta `bun run lab:demo` para mostrar la reconstrucción desde los 10 documentos ficticios de AetherCloud e índice vacío sobre `vector(768)` e índice HNSW (`lab/schema.sql`), la respuesta citada y el rechazo previo sin llamar al generador.

---

## S11: CRAG con reordenamiento (`rank`) y valoración (`assess`) separados

1. **Separación entre recuperar, reordenar y juzgar suficiencia:**
   - Selecciona **CRAG** y grupo **General**.
   - Explica los nodos separados del grafo (`apps/api/src/crag-graph.ts` y `lab/src/crag-graph.ts`):
     - `retrieve`: recupera hasta **10 candidatos**.
     - `rank`: reordena los candidatos y valida que cada puntuación esté en la **escala cerrada `[0, 1]`** (`CRAG_SCORE_THRESHOLDS`).
     - `assess`: valora por separado si los fragmentos útiles (`score >= 0,50`) cubren toda la pregunta (`cobertura >= 0,75` sin lagunas → `sufficient`; `0,40–0,74` o con laguna → `partial`; `< 0,40` → `insufficient`).
2. **Demostración de evidencia suficiente y parcial:**
   - Pregunta simple (_«¿Cómo modela LangGraph un agente con estado y nodos?»_): 1 búsqueda, `rank` y `assess` declaran `sufficient` con S5 y responde con cita.
   - Pregunta compuesta (_«¿Cómo modela LangGraph el estado de un agente y cómo se observa esa ejecución?»_ en la demo o el caso mTLS + SEV-1 en `bun run lab:demo`): muestra cómo un fragmento individual tiene relevancia alta (`0,80 >= 0,50`) pero la cobertura global de la pregunta es `partial` (`0,50 < 0,75`), por lo que `retain` conserva el primer fragmento, `reformulate` busca la laguna y la segunda búsqueda une ambas fuentes sin duplicar IDs.
3. **Límite de 3 búsquedas, 2 reformulaciones y 20 segundos:**
   - Pregunta por un dato inexistente (beca de 1991 o pago con criptomonedas en `lab/`): el grafo agota 3 búsquedas y 2 reformulaciones y termina en `refuse` con **0 llamadas al generador**.
4. **Lectura de métricas y resultados de comparación:**
   - Muestra ambas tablas de 20 preguntas (14 respondibles + 6 sin respuesta):
     - **Laboratorio reproducible (`lab/eval/resultados-laboratorio.md`):** RAG básico `16/20` (`10/14` respondibles, `6/6` rechazos, **`1,00` recuperaciones medias**) frente a CRAG `17/20` (`11/14` respondibles, `6/6` rechazos, **`1,80` recuperaciones medias**).
     - **Lote histórico cloud del 3 de octubre (`material/comparacion/resultados/tabla-resultados.md`, etiquetado como histórico):** RAG `17/20` (`11/14`, `6/6`, **`0,95` recuperaciones medias**, mediana `1,193 s`) frente a CRAG `18/20` (`13/14`, `5/6`, **`1,55` recuperaciones medias**, mediana `4,304 s`).

---

## Seguridad, costes y respaldo

- **Protección pública:** Turnstile Managed (`interaction-only`), cookie de sesión firmada y cuotas (6 req/60 s por sesión, 120 req/60 s por IP) antes de tocar el presupuesto D1 (`material/notas/proteger-un-chat-publico.md`).
- **Honestidad de costes:** el importe mostrado en el chat corresponde a la generación final; los consumos desconocidos viajan como `null`, nunca como `0`.
- **Respaldo sin red:** si falla la conectividad o el presupuesto, continúa con `bun run dev` (`APP_MODE=demo`) y `bun run lab:demo`, indicando siempre qué perfil estás proyectando.
