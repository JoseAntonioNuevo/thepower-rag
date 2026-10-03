# Criterios manuales de la comparación

Criterios definidos antes de la ejecución. El 3 de octubre de 2026 se aplicaron manualmente a las 40 respuestas de `resultados/resultados.json`.

Cada pregunta del conjunto reservado se puntúa por separado en RAG básico y en CRAG. No se suma un porcentaje global hasta que las veinte existan.

## Corrección

- Respondible: la respuesta contiene el dato esperado y no lo contradice. Parafrasear está bien. Añadir un hecho que no está en la fuente citada está mal.
- No respondible: la respuesta rechaza o dice que no consta. Dar un aula, un precio, un correo o una versión que no está en el corpus está mal, aunque suene plausible.

## Apoyo de la fuente

- La cita es uno de los ids esperados, o el id de la sección correcta si la segmentación cambió y el texto sigue siendo ese.
- Una cita extra es aceptable si el texto extra no contradice ni mete otro calendario.
- Citar el calendario de la otra cohorte en una pregunta de M/J o de L/X anula el apoyo.
- En una pregunta sin apoyo, cualquier cita usada como si contuviera el dato es un fallo.

## Rechazo adecuado

- Pregunta sin apoyo y rechazo sin cita falsa: correcto.
- Pregunta con apoyo y rechazo: fallo de recuperación o de juicio, no un acierto de prudencia.
- Pregunta de calendario sin la audiencia pedida: debe aclarar, no inventar el día. En este conjunto las preguntas de fecha ya fijan la audiencia de ejecución.

## Intentos de recuperación

- RAG básico: 1 o 0. Cero solo si ni siquiera busca porque pide una aclaración que no tocaba.
- CRAG: de 0 a 3. Más de 3 es un fallo del límite, aunque la respuesta sea correcta.
- Reformulaciones de CRAG: de 0 a 2.
- Generación en un rechazo final: debe ser 0.

## Latencia

- Se anota el tiempo local hasta tener la respuesta completa, en milisegundos.
- No se rellena con el tiempo de la demo lexical del 3 de octubre. Aquellos tiempos son de otro perfil.
- Si la medición falla, queda vacía. No se copia la de la otra etapa.

## Uso y coste

- Si el proveedor devuelve tokens y un importe, se copian.
- Si no los devuelve, uso y coste quedan **desconocidos**.
- No se escribe 0 para «no lo sé».
- La demo `offline-fixture` usa la frase «no medido». Esa etiqueta no se traslada a una fila de la comparación real.

## Tabla

La tabla está en `resultados/tabla-resultados.md`. Las 40 filas se rellenaron tras ejecutar y revisar las respuestas reales; no se ajustó el sistema a este conjunto.
