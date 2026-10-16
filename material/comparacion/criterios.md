# Criterios manuales de la comparación (S10 y S11)

Criterios definidos antes de ejecutar cualquier lote de 20 preguntas (14 respondibles y 6 sin respuesta), aplicables tanto al laboratorio reproducible (`lab/eval/resultados-laboratorio.md`) como a los lotes reales del demostrador (`resultados/tabla-resultados.md`).

Cada pregunta se puntúa por separado en **RAG básico** y en **CRAG**. Una evaluación preparada pero sin ejecutar puede declararse con honestidad, pero no equivale a una evaluación completada.

## 1. Corrección de la respuesta (`X/14` y `Y/6`)

- **Pregunta respondible (14 casos):** la respuesta contiene los datos esperados y no los contradice. Parafrasear es válido; inventar un dato que no figura en los fragmentos citados anula el punto.
- **Pregunta no respondible (6 casos):** el sistema rechaza la pregunta o indica explícitamente que no consta en la documentación, **sin llamar al generador cuando el control previo o el límite de CRAG cortan la ejecución**. Inventar un precio, aula, teléfono, región o licencia anula el punto.

## 2. Apoyo de la fuente citada

- Cada afirmación debe respaldarse con `[cite:id]` apuntando a los fragmentos reales que contienen el dato.
- En preguntas compuestas que requieren dos secciones o dos documentos distintos, deben citarse ambos orígenes sin duplicar el mismo `chunkId`.
- En una pregunta sin respuesta en el corpus, citar un fragmento irrelevante como si respaldase un hecho inventado es un fallo.

## 3. Intentos de recuperación y recuperaciones medias (requisito S11)

- **RAG básico:** como máximo `1` búsqueda vectorial por pregunta (`0` solo si una validación previa de cohorte pide aclaración antes de embeber).
- **CRAG:** entre `0` y `3` búsquedas por pregunta (búsqueda inicial más un máximo de `2` reformulaciones). Superar `3` búsquedas o `2` reformulaciones incumple el límite del grafo.
- **Recuperaciones medias:** la tabla resumen debe informar el promedio de recuperaciones por pregunta (`total_búsquedas / 20`) en ambas variantes para cuantificar el sobrecoste de iteración de CRAG frente al RAG básico.
- **Generación en un rechazo final:** debe ser `0` llamadas al generador.

## 4. Latencia, consumo y coste

- Se registra la duración de cada turno en milisegundos y se informa la mediana (y media) por etapa.
- Si el proveedor devuelve tokens y coste se registran; si no se miden o no se devuelven, permanecen como **desconocidos / no medidos**, nunca como `0`.
