# Comandos y resultados

Medidos el 3 de octubre de 2026 en este Mac, dentro de `/Users/jose/Documents/the-power/3-rag`. El servidor de la demo ya estaba en marcha cuando se cronometraron las peticiones HTTP. No son tiempos de un aula llena.

## Antes de la demo

| Comando                                     | Código | Tiempo | Qué salió                                                                                                                                            |
| ------------------------------------------- | ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run preflight`                         | 0      | 0,14 s | `APP_MODE efectivo: demo`. Sin RAG `offline-demo`. RAG y CRAG `offline-fixture`. `verificado remotamente: no`. Bun 1.4.2. Node del sistema v24.16.0. |
| `bun run preflight -- --capability sin-rag` | 0      | 0,09 s | Añade `capacidad pedida: sin-rag`. Sigue en demo.                                                                                                    |
| `bun run preflight -- --capability rag`     | 0      | 0,09 s | `capacidad pedida: rag`.                                                                                                                             |
| `bun run preflight -- --capability crag`    | 0      | 0,09 s | `capacidad pedida: crag`.                                                                                                                            |
| `bun run activate`                          | 0      | 0,05 s | Plan. `comando plan: simulación, sin red`.                                                                                                           |
| `bun run activate -- plan`                  | 0      | 0,04 s | El mismo plan, sin red.                                                                                                                              |
| `bun run ingest-plan`                       | 0      | 0,03 s | Imprime el plan de activación. No embebe ni crea recursos.                                                                                           |

`bun run dev` anunció `http://localhost:5173/`. No se usó `--host`.

## Salud

`GET http://localhost:5173/api/health` respondió 200 en 0,033 s.

Campos útiles: `phase` `crag`, `execution` `demo`, corpus `c3a59a406888b`, contenido `cc037ef0bb1f7`, perfil `p9e8e8e03627e`, familia `fixture`, embedding `fixture-token-hash-v1`, 128 dimensiones, `remoteRevision` null, cobertura de ejercicios `partial`, remoto `not-verified`.

La línea de estado traduce el perfil a demo (fixture) y el temario a completo. Detalle del corpus muestra calendarios completos, ejercicios parcial y remoto no verificado.

## Preguntas de la demo

Todas `POST /api/chat`, HTTP 200. El cuerpo lleva `mode`, `audience` y `messages` con `parts: [{ type: "text", text }]`. En CRAG con guion se añade `demoScenario`.

| Caso                                        | Tiempo  | Texto que hay que reconocer                                                                                                                                  |
| ------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sin RAG, pregunta de LangGraph              | 0,196 s | `Demostración local sin modelo.` Origen `offline-demo`. Uso y coste no medidos.                                                                              |
| RAG básico, misma pregunta, General         | 0,011 s | Empieza por `Respuesta de la canalización local de prueba.` Cita `c3a59a406888b:s05-langgraph:00` y, en esta pasada, también `c3a59a406888b:s14-agentes:00`. |
| RAG, beca de 1991, General                  | 0,004 s | `No hay contexto utilizable en el corpus seleccionado.`                                                                                                      |
| RAG, «¿Cuándo es la clase de RAG?», General | 0,004 s | Pide elegir L/X o M/J.                                                                                                                                       |
| RAG, «¿Cuándo es la clase de RAG S10?», M/J | 0,003 s | Cita `c3a59a406888b:calendario-mj:10` y `2026-10-22`. No apareció `2026-10-26`.                                                                              |
| CRAG `sufficient-s5`                        | 0,009 s | Cita S5. Prefijo `Respuesta de prueba del grafo CRAG.`                                                                                                       |
| CRAG `partial-s5-s6`                        | 0,008 s | Cita S5 y S6.                                                                                                                                                |
| CRAG `irrelevant-then-s6`                   | 0,007 s | Cita S6.                                                                                                                                                     |
| CRAG `missing-info`                         | 0,006 s | Rechazo. Búsquedas 3, reformulaciones 2, generación 0.                                                                                                       |
| CRAG `clarify-cohort`                       | 0,004 s | Pide cohorte. Búsquedas 0.                                                                                                                                   |
| CRAG `evaluator-error`                      | 0,004 s | `El evaluador devolvió una salida que no se puede usar. No se reintenta.`                                                                                    |
| CRAG libre, modelos abiertos, General       | 0,004 s | Cita `c3a59a406888b:s07-modelos-abiertos:00`. Sigue siendo canalización de prueba.                                                                           |

El rechazo CRAG de la beca trajo `origin` `offline-fixture`, `completion` `refused`, `usage` null y `cost` null. El escenario era `missing-info` y `fixture` true.

## Comandos que no se lanzaron

No se ejecutó `activate --execute`, ni `status --read`, ni la sonda, ni la ingesta, ni `test`, ni `test:entrypoint`. Esos últimos ya constan en `docs/phase-7-verification.md` y el código no cambió en este paquete.
