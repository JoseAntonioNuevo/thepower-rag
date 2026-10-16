# RAG del curso con contexto completo (variante sobre corpus pequeño)

> **Nota docente para S10:** la referencia principal configurada para enseñar S10 es el **recorrido semántico (`RAG_CONTEXT_MODE=semantic`)** en `apps/web/wrangler.jsonc` (`apps/api/src/app.ts:670`) y el **laboratorio reproducible de PostgreSQL + `pgvector` (`lab/`)**, que seleccionan fragmentos por puntuación y deciden antes de generar si falta evidencia. El modo `RAG_CONTEXT_MODE=complete` descrito en este documento se presenta en clase **después** del recorrido semántico como una variante específica para corpus muy pequeños.

Actualizado tras reproducir «¿qué días hay clase?» en RAG básico el 3 de octubre de 2026. El calendario completo se recuperaba con coseno `0,446`, por debajo de `0,50`, antes de contar con el atajo explícito de horario semanal (`packages/rag/src/calendar.ts`).

## Cuándo resulta útil la variante de contexto completo (`RAG_CONTEXT_MODE=complete`)

El corpus del curso ocupa unos 23 000 caracteres: veinte documentos de sesiones y dos calendarios (49 fragmentos por grupo). Cabe entero en la ventana del modelo. Cuando se configura `RAG_CONTEXT_MODE=complete` (`apps/api/src/course-context.ts`), la API recupera en una consulta D1 todos los fragmentos comunes más el calendario del grupo seleccionado, sin calcular embedding de la consulta ni aplicar el filtro de similitud `0,50`.

Se valida que el catálogo coincida exactamente con todos los fragmentos del manifiesto (máximo 200 fragmentos y 32 000 caracteres de contenido). Si faltan datos, devuelve un error 409 de configuración; nunca trunca ni cae a fixtures.

## Por qué el recorrido semántico (`RAG_CONTEXT_MODE=semantic`) es la referencia principal de S10

1. **Demuestra el requisito del ejercicio:** embebe la pregunta (`@cf/baai/bge-m3` de 1024 d en el demostrador; `EMBEDDING_MODEL_ID` de 768 d en `lab/`), consulta el índice vectorial con filtro, ordena candidatos por puntuación, aplica el umbral calibrado antes de llamar al modelo y **rechaza sin invocar al generador** cuando ningún fragmento supera el corte.
2. **Escala a corpus reales:** la variante `complete` deja de ser viable en cuanto la documentación supera unas decenas de páginas. En cambio, el recorrido semántico y CRAG mantienen acotado el contexto enviado al modelo.
3. **Coherencia en la traza:** en modo `semantic`, la traza muestra las puntuaciones de similitud y el umbral `0,50`. En modo `complete`, la traza indica `complete-course-context-d1` con puntuación `null` para no confundir una lectura completa de D1 con una búsqueda vectorial.

## Verificación histórica de la variante `complete`

- 12 consultas dirigidas con D1 real (`docs/evidence/course-context/directed-results.json`): días de ambos grupos, horario, total de sesiones, lista S1–S20, temas, ejercicios, profesores, festivos, próxima sesión, seguimiento y datos ausentes.
- La comparación reservada de 40 respuestas del 3 de octubre (`material/comparacion/resultados/tabla-resultados.md`) evaluó el modo vectorial con el modelo de aquella fecha (`openai/gpt-6-luna`), y se conserva etiquetada como evaluación histórica.
