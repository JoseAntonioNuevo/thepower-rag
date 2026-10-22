# Ensayo real de S10 · resultados y límites

20 de octubre de 2026. PostgreSQL 17 + pgvector 0.8.7, 20 fragmentos de 10 documentos ficticios, Gemini Embedding 2 por OpenRouter (768 dimensiones) y Sonnet como generador.

Perfil: `5a2d65a60a2c9f4bc43bbbd7e7a9be89a6275411dc6b10ca13f76c49edbb542c`. Umbral congelado con seis preguntas de validación: **0,724767**. El test contiene 20 preguntas nuevas, distintas de la validación y de las consultas de aula. No se cambió el sistema después del resultado.

| Métrica                                    | Resultado |
| ------------------------------------------ | --------: |
| Respondibles completas y apoyadas          |  **9/14** |
| Rechazos correctos sin respuesta en corpus |   **6/6** |
| Total                                      | **15/20** |
| Recuperaciones por pregunta                |         1 |
| Mediana de latencia                        | 1721.5 ms |

## Qué enseñan los fallos

Tres abstenciones incorrectas (4, 6 y 14) y dos respuestas parciales (5 y 10). Un corte único puede perder evidencia necesaria aunque exista en el corpus. Los casos 5 y 10 reconocen explícitamente el dato que no llegó; no se convierten por ello en respuestas completas. Son buenos ejemplos para motivar S11 sin afirmar de antemano que CRAG vaya a mejorar.

## Revisión por caso

| Caso | Tipo          | Decisión | Correcto | Motivo                                                                                            |
| ---: | ------------- | -------- | -------- | ------------------------------------------------------------------------------------------------- |
|    1 | Respondible   | answer   | Sí       | Respuesta completa respaldada por los fragmentos citados.                                         |
|    2 | Respondible   | answer   | Sí       | Respuesta completa respaldada por los fragmentos citados.                                         |
|    3 | Respondible   | answer   | Sí       | Respuesta completa respaldada por los fragmentos citados.                                         |
|    4 | Respondible   | refuse   | No       | Abstención incorrecta: el fragmento de revocación existe pero quedó por debajo del corte.         |
|    5 | Respondible   | answer   | No       | Respuesta parcial: el corte excluyó el fragmento del tamaño máximo de POST.                       |
|    6 | Respondible   | refuse   | No       | Abstención incorrecta: la renovación de DEK existe en el corpus y no superó el corte.             |
|    7 | Respondible   | answer   | Sí       | Respuesta completa respaldada por los fragmentos citados.                                         |
|    8 | Respondible   | answer   | Sí       | Respuesta completa respaldada por los fragmentos citados.                                         |
|    9 | Respondible   | answer   | Sí       | Respuesta completa respaldada por los fragmentos citados.                                         |
|   10 | Respondible   | answer   | No       | Respuesta parcial: llegó la cuota base, pero el fragmento del recargo quedó por debajo del corte. |
|   11 | Respondible   | answer   | Sí       | Respuesta completa respaldada por los fragmentos citados.                                         |
|   12 | Respondible   | answer   | Sí       | Respuesta completa respaldada por los fragmentos citados.                                         |
|   13 | Respondible   | answer   | Sí       | Respuesta completa respaldada por los fragmentos citados.                                         |
|   14 | Respondible   | refuse   | No       | Abstención incorrecta en pregunta compuesta; la evidencia existe en dos documentos.               |
|   15 | Sin respuesta | refuse   | Sí       | Rechazo correcto: el dato solicitado no consta en el corpus.                                      |
|   16 | Sin respuesta | refuse   | Sí       | Rechazo correcto: el dato solicitado no consta en el corpus.                                      |
|   17 | Sin respuesta | refuse   | Sí       | Rechazo correcto: el dato solicitado no consta en el corpus.                                      |
|   18 | Sin respuesta | refuse   | Sí       | Rechazo correcto: el dato solicitado no consta en el corpus.                                      |
|   19 | Sin respuesta | refuse   | Sí       | Rechazo correcto: el dato solicitado no consta en el corpus.                                      |
|   20 | Sin respuesta | refuse   | Sí       | Rechazo correcto: el dato solicitado no consta en el corpus.                                      |

## Costes y alcance

El diario acumuló **0.263443 USD en reservas** de un máximo de 1 USD para preparación y ensayo, con 42 llamadas en total. Incluye operaciones anteriores al test (ingesta, calibración y consultas de aula). Las reservas son conservadoras y no se liberan suponiendo una factura. `actualProviderUsd` sigue siendo `null`.

Se guardan las respuestas originales, candidatos, puntuaciones, selección, citas, latencia y uso observado en [evaluacion-real.json](evaluacion-real.json). La revisión manual contrasta las afirmaciones con las fuentes; es una muestra pequeña de laboratorio, no una tasa general de calidad. El lote es S10 RAG básico: no acredita CRAG real.

El respaldo offline conserva sus métricas históricas por separado. No son resultados de estos modelos.
