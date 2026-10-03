# Matriz de requisitos, ejemplos y evidencia

Fecha de la matriz: 3 de octubre de 2026. La columna de evidencia local es de la demo `fixture`. La columna remota está pendiente salvo donde una fase anterior ya registró una lectura, y esa lectura no se repite aquí como si fuera nueva.

| Requisito                          | Ejemplo que se enseña                  | Evidencia local                                                        | Remoto                                                |
| ---------------------------------- | -------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| Asistente de S1–S20 y dos cohortes | Banner y `corpus/COVERAGE.md`          | Salud HTTP 200, perfil `p9e8e8e03627e`                                 | Índice no creado                                      |
| Sin RAG no recupera                | Pregunta de LangGraph en etapa Sin RAG | Texto `Demostración local sin modelo.` Captura `sin-rag`               | OpenRouter no llamado. Falta `MODEL_ID`               |
| Una búsqueda con cita              | RAG básico, misma pregunta             | Cita `s05-langgraph:00` y también `s14-agentes:00` por el hash lexical | Vectorize no consultado                               |
| Puntuación no es probabilidad      | Traza de RAG                           | Frase de código: coseno del índice de prueba por tokens                | Umbral semántico no calibrado                         |
| Rechazo sin inventar               | Beca de 1991 en RAG básico             | `No hay contexto utilizable`                                           | Igual, no ejecutado en real                           |
| Cohortes separadas                 | RAG S10 en M/J                         | `calendario-mj:10`, `2026-10-22`, sin `2026-10-26`                     | No ejecutado                                          |
| S9 sigue en PostgreSQL             | Ficha `s09-postgresql-pgvector`        | Texto de la ficha en el corpus                                         | No es un cambio de programa                           |
| CRAG suficiente de guion           | `sufficient-s5`                        | Cita S5. `Guion de prueba`                                             | No mide calidad                                       |
| CRAG parcial                       | `partial-s5-s6`                        | Cita S5 y S6                                                           | No ejecutado en real                                  |
| Descarte                           | `irrelevant-then-s6`                   | Respuesta con S6                                                       | No ejecutado en real                                  |
| Límite de intentos                 | `missing-info`                         | 3 búsquedas, 2 reformulaciones, generación 0                           | No ejecutado en real                                  |
| Aclaración sin buscar              | `clarify-cohort`                       | 0 búsquedas                                                            | No ejecutado en real                                  |
| Error sin reintento                | `evaluator-error`                      | `No se reintenta`                                                      | No ejecutado en real                                  |
| Pregunta libre                     | Modelos abiertos, sin guion            | Cita `s07-modelos-abiertos:00` en la pasada lexical                    | No es calibración                                     |
| Documento sintético aislado        | `fragmento-sintetico.json`             | Se abre y no se ingiere                                                | No hay reindexado                                     |
| CLI unido al Worker                | Fase 7, `docs/phase-7-verification.md` | `test:entrypoint` ya pasó en esa fase. No se relanzó hoy               | `remote: true` no arrancado                           |
| Comparación de 20 del profesor     | `material/comparacion/`                | Protocolo escrito, sin tabla                                           | Resultados pendientes. No es la evaluación del alumno |
| Encargo original                   | Fichas S10 y S11                       | Sigue pidiendo su evaluación de 20 preguntas propias                   | No se anula por la activación pendiente               |
| Laboratorio fixture                | `bun run dev` en demo                  | Control de flujo. No mide calidad                                      | No sustituye la evaluación original                   |
| Código portable                    | `material/S10-S11-demo-codigo.zip`     | Instalación congelada y salud local, ver `evidencias/qa-final.md`      | Alta remota excluida. No usa la cuenta del profesor   |
| QR de la clase anterior            | `material/assets/qr-ai-engineer.jpg`   | Decodifica al formulario `form=ai-engineer`                            | No se ha enviado una evaluación                       |

Dos huecos de la verificación real, separados del presupuesto: umbral calibrado que el arranque remoto todavía no recibe, e inyección del secreto de OpenRouter en las variables efímeras del Worker. Están en `docs/review/phase-7-review.txt`.
