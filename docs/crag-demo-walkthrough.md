# Recorrido de CRAG en demo

La demo no usa clave, binding remoto ni crédito. El selector de guion solo se envía si la salud dice `demo`. En `real` el servidor ignora `demoScenario`.

Los seis guiones están en `corpus/fixtures/crag-development-cases.json`. No son la comparación reservada. Una coincidencia exacta con la pregunta del guion también lo selecciona. Una pregunta libre usa el índice lexical `fixture-token-hash-v1`, umbral 0,33 y un evaluador de reglas. Eso no mide CRAG.

```sh
bun run dev
```

Abre `http://localhost:5173/`. Elige CRAG. El perfil demo marca la etapa como canalización local de prueba.

| Guion                        | Pregunta                                                                       | Recorrido esperado                                                       |
| ---------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Suficiente a la primera      | ¿Cómo modela LangGraph un agente con estado y nodos?                           | `retrieve`, `rank`, `answer`. Una búsqueda. Cita S5. No cita S6.         |
| Evidencia parcial            | ¿Cómo modela LangGraph el estado de un agente y cómo se observa esa ejecución? | Conserva S5, reformula, recupera S6, deduplica y cita las dos.           |
| Primera evidencia descartada | ¿Qué cubre la sesión de observabilidad del programa?                           | Descarta S16. La respuesta cita solo S6.                                 |
| Dato ausente                 | ¿Qué beca interna del año 1991 cubre este programa?                            | Tres búsquedas, dos reformulaciones, rechazo, sin cita y sin generación. |
| Calendario sin cohorte       | ¿Cuándo es la sesión de RAG avanzado?                                          | Pide L/X o M/J. Cero búsquedas.                                          |
| Fallo del evaluador          | Provoca un fallo controlado del evaluador de prueba.                           | Una evaluación inválida. No hay reintento ni respuesta de modelo.        |

El panel muestra el motivo operativo, el orden y la puntuación, los ids conservados o descartados y los intentos que quedan. Un mismo id descartado en varios intentos conserva cada intento con su propia clave. El selector de guion queda desactivado mientras la respuesta está en curso. Los pasos intermedios viajan como eventos transitorios y no entran en el historial. El resumen final sí. Detener corta el trabajo local nuevo. No cancela un cómputo que el proveedor ya hubiera empezado; en demo no hay proveedor.

Sin RAG y RAG básico siguen en la misma pantalla. Cambiar de etapa vacía la conversación. RAG básico sigue haciendo una sola búsqueda.
