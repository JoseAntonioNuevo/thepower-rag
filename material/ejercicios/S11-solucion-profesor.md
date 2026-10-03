# Referencia de corrección · S11

El RAG básico de S10 tiene que seguir funcionando. El grafo no lo sustituye.

## Cuatro planos, al corregir

- El encargo original pide comparar el RAG básico y el CRAG con veinte preguntas nuevas del alumno. Esa comparación no se anula porque falte la activación del profesor.
- La demo de clase es la adaptación sobre este asistente. No es una reproducción de arXiv:2401.15884 ni una victoria medida.
- Los seis guiones y el índice lexical demuestran rutas, orden y límites. Un acierto de guion no es calidad de modelo.
- El conjunto reservado del profesor sigue sin ejecutarse. No se reparte y no se usa para puntuar al alumno. Si el alumno no pudo ejecutar su propia comparación, la tabla vacía es correcta y una tabla inventada no lo es. No inventéis rúbrica, aprobación ni plazo.

## Criterios

| Criterio       | Hecho                                                   | A medias                                             | No                                           |
| -------------- | ------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------- |
| Misma base     | La etapa de una búsqueda sigue disponible               | El código está, pero la interfaz lo esconde          | Se borró el RAG básico                       |
| Orden aplicado | El contexto final sigue el ranking validado             | Ordena solo por puntuación y deshace empates al azar | `usefulIds` se usa como si ya fuera el orden |
| Suficiente     | Hay texto útil y no queda laguna                        | Acepta un JSON sin texto                             | —                                            |
| Parcial        | Conserva ids y busca la laguna, sin duplicar            | Vuelve a meter todo el contexto anterior             | Pierde lo ya conservado                      |
| Insuficiente   | Ese contexto no llega a la respuesta                    | Lo cita «por si acaso»                               | —                                            |
| Descarte       | Fila con id, motivo e intento                           | Solo el último intento                               | Borra el historial de descarte               |
| Reformulación  | No sustituye la pregunta original                       | La respuesta olvida la pregunta                      | Reformulación vacía y sigue                  |
| Límites        | 3 búsquedas, 2 reformulaciones, un plazo, fallo contado | El plazo se reinicia en cada nodo                    | Una cuarta búsqueda o un reintento oculto    |
| Traza          | Se ven pregunta, consulta, orden y listas               | Solo el texto final                                  | La traza dice que es real cuando es un guion |
| Comparación    | Protocolo escrito y números vacíos si no se ejecutó     | —                                                    | Tabla de aciertos inventada                  |
| Coste          | Llamadas no medidas siguen como no medidas              | —                                                    | Suma un cero                                 |

## Qué hace el proyecto de referencia en demo

Los seis guiones de `corpus/fixtures/crag-development-cases.json` producen, con audiencia General:

| Guion                | Señal visible                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `sufficient-s5`      | Cita S5. Una búsqueda.                                                                         |
| `partial-s5-s6`      | Cita S5 y S6, sin duplicar el id.                                                              |
| `irrelevant-then-s6` | La respuesta cita S6. El panel puede descartar S16.                                            |
| `missing-info`       | Rechazo, 3 búsquedas, 2 reformulaciones, generación 0. El id de S16 sale en los tres intentos. |
| `clarify-cohort`     | Pide cohorte. Cero búsquedas.                                                                  |
| `evaluator-error`    | `No se reintenta.`                                                                             |

El prefijo de esas respuestas es `Respuesta de prueba del grafo CRAG. El guion no mide calidad ni llama a un modelo.` El panel dice `Guion de prueba.`

La pregunta libre sobre modelos abiertos, sin guion, citó en la pasada del 3 de octubre `c3a59a406888b:s07-modelos-abiertos:00` por el índice lexical. No se usa como nota de calidad.

Límites de código: `CRAG_BOUNDS` en `packages/rag/src/crag.ts`. Plazo 20000 ms de una sola vez. Autores del artículo en `docs/crag-graph.md`.

## No se acepta como comparación

Un cuadro con porcentajes, latencias o dólares si no hay una ejecución autorizada. El conjunto reservado del profesor está en `material/comparacion/` y no se ha ejecutado: no es la comparación que el alumno debe entregar. La comparación del encargo original, si el alumno la hizo, tiene que ser la suya y estar etiquetada con el medio real que usó. Una fila fixture no cuenta como esa medición.
