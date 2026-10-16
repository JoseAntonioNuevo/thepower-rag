# Protocolo de comparación entre RAG básico y CRAG

Este directorio documenta el protocolo de comparación justa entre **RAG básico (S10)** y **CRAG (S11)** sobre conjuntos cerrados de **20 preguntas (14 respondibles y 6 sin respuesta)** y separa tres artefactos con su procedencia exacta:

1. **Evaluación ejecutada del laboratorio reproducible (`lab/eval/resultados-laboratorio.md`):**
   - Ejecutada sobre el laboratorio de PostgreSQL + `pgvector` (`vector(768)` + índice HNSW, 10 documentos ficticios de AetherCloud, 20 fragmentos).
   - **Resultados medidos (40 ejecuciones):**
     - **RAG básico (S10):** `16/20` totales (`10/14` respondibles, `6/6` rechazos, **`1,00` recuperaciones medias**).
     - **CRAG (S11, nodos `retrieve → rerank → assess` separados):** `17/20` totales (`11/14` respondibles, `6/6` rechazos, **`1,80` recuperaciones medias**, `0,80` reformulaciones medias).

2. **Evaluación histórica en la nube del 3 de octubre de 2026 (`resultados/tabla-resultados.md` y `resultados/configuracion-congelada.json`):**
   - Ejecutada el 3 de octubre de 2026 contra `https://rag-thepower.josenuevo.dev` con la configuración congelada de aquel día (`openai/gpt-6-luna`, razonamiento `none`, BGE-M3 `1024` dimensiones, perfil `p76509a5f9743`, umbral `0,50`).
   - **Resultados históricos (40 respuestas reales):**
     - **RAG básico:** `17/20` (`11/14` respondibles, `6/6` rechazos, **`0,95` recuperaciones medias**, mediana `1193 ms`).
     - **CRAG:** `18/20` (`13/14` respondibles, `5/6` rechazos, **`1,55` recuperaciones medias**, `0,60` reformulaciones medias, mediana `4304 ms`).
   - **Por qué es histórica:** con posterioridad a esa ejecución cambiaron los hashes de `apps/api/src/prompts.ts`, `apps/api/src/crag-real.ts` y `apps/api/src/model.ts` (paso a `claude-haiku-5-5` y separación de `rank` y `assess` con escala `[0, 1]`). Esos números no se atribuyen al código actual.

3. **Nuevo conjunto reservado congelado para la referencia actual (`conjunto-reservado-referencia-actual-20.md` y `configuracion-referencia-actual.json`):**
   - Preparado con 20 preguntas nuevas (14 respondibles y 6 sin apoyo, disjuntas del lote histórico del 3 de octubre, de la calibración y de los 6 guiones) y con los hashes SHA-256 vigentes de la referencia actual (`claude-haiku-5-5`, `RAG_CONTEXT_MODE=semantic`, `rank` + `assess` en `[0, 1]`).
   - Listo para ejecutarse con `bun scripts/compare-live.ts --config material/comparacion/configuracion-referencia-actual.json --execute` cuando se autorice un presupuesto de lote en vivo.

## Condiciones que deben mantenerse idénticas entre RAG básico y CRAG

- **Mismo corpus y mismo índice vectorial:** versión `c3a59a406888b` y perfil `p76509a5f9743` en el demostrador del curso, o versión `lab-689164ca81cd` (`vector(768)` + HNSW) en el laboratorio reproducible.
- **Mismo modelo generativo, mismas instrucciones base de citas y mismos parámetros de salida.**
- **Umbrales calibrados con validación previa, nunca con las 20 preguntas de test.**
- **Conversación limpia en cada pregunta**, sin arrastrar historial de preguntas anteriores.
- **Métricas obligatorias:** aciertos sobre 14 respondibles (`X/14`), rechazos correctos sobre 6 sin respuesta (`Y/6`), **recuperaciones medias por pregunta**, reformulaciones medias, latencia (mediana y media) y revisión manual del apoyo en las fuentes citadas.
