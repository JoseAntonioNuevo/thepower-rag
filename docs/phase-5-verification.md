# Verificación de la fase 5

Fecha de las comprobaciones: 3 de octubre de 2026. Node del sistema v24.16.0. Bun 1.4.2. No hubo alta de recursos, despliegue, commit ni llamada de pago.

## Qué cambió

- Un listado Vectorize con salida 0 y JSON que no es un array de índices queda en lectura no confirmada. Lo mismo vale para el listado de metadatos si no trae `propertyName`. Esa lectura no crea recursos. La regresión no llama a la cuenta.
- CRAG ejecuta un `StateGraph` con validar, buscar, ordenar y evaluar, conservar o descartar, reformular y responder o rechazar. El máximo es tres búsquedas y dos reformulaciones. Cada turno empieza de cero.
- La demo inyecta guiones en ese mismo grafo. El RAG básico sigue siendo una búsqueda distinta. CRAG real incompleto responde 409 y no cae a la demo ni al RAG básico.
- `EVALUATOR_MODEL_ID` solo bloquea CRAG. Sin RAG y RAG básico no lo piden.
- Los pasos del grafo salen como eventos transitorios. El historial guarda un resumen y, como máximo, seis fuentes. Un seguimiento después de ese máximo sigue siendo válido.
- `probeEmbeddings()`, `ingest()` y `verify()` del CLI siguen rechazando sin red. `resume()` lee la configuración administrativa del índice; no es el diario ni la reanudación de visibilidad del núcleo.

## Corpus

Los identificadores no cambiaron:

| Capa                  | Estado                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| Preparación           | `c3a59a406888b`                                                        |
| Contenido             | `cc037ef0bb1f7`                                                        |
| Perfil lexical        | `p9e8e8e03627e`, `fixture-token-hash-v1`, 128 dimensiones, umbral 0,33 |
| Temario y calendarios | completos                                                              |
| Ejercicios            | parciales: 12 resúmenes y 8 títulos                                    |
| Remoto                | no verificado                                                          |

## Comandos locales

```sh
bun install --frozen-lockfile
bun run check
bun run test
bun run build
bun run preflight
bun run preflight -- --capability sin-rag
bun run preflight -- --capability rag
bun run preflight -- --capability crag
bun run activate
bun run activate -- plan
```

- Instalación congelada: 183 instalaciones, 335 paquetes, sin cambios.
- `check`: formato, lint y tipos sin avisos en 65 archivos TypeScript.
- `test`: 65 pruebas en 11 archivos, todas en verde. No abren la red.
- `build`: Worker `dist/thepower_rag/index.js` de 3.093,05 kB. No es un despliegue.
- Preflight demo, sin RAG, RAG y CRAG: código 0. CRAG en demo figura como `offline-fixture`. Sigue sin verificación remota.
- `activate` y `activate -- plan`: código 0, sin red.

## Workerd

`bun run dev` sirvió `http://localhost:5173/` con runtime `Cloudflare-Workers`. La salud devolvió fase `crag`, ejecución `demo`, CRAG `offline-fixture`, preparación `c3a59a406888b`, contenido `cc037ef0bb1f7` y perfil `p9e8e8e03627e`.

El mismo origen recorrió los guiones:

- S5 suficiente: una búsqueda, pasos `retrieve`, `rank`, `answer`.
- S5 y S6: dos búsquedas, una reformulación, con `retain`.
- S16 descartada y respuesta solo con S6, con `discard`.
- Beca de 1991: tres búsquedas, dos reformulaciones, `refuse`.
- Calendario general: `clarify`, cero búsquedas.
- Evaluador inválido: `error` tras una búsqueda, sin reformulación.
- RAG básico siguió citando S5 por la canalización lexical, sin pasos de CRAG.
- Sin RAG siguió en `offline-demo`.

No hay herramienta de navegador en esta sesión. No se hizo clic en la interfaz ni se comprobó el diseño a 390 px. El HTML servido incluye viewport y el módulo del cliente. El proceso de desarrollo se detuvo al terminar.

## Lo que no está verificado

- El adaptador real de CRAG está escrito con `generateObject` y `generateText`, reintentos a 0 y espera local acotada. No se ejecutó contra OpenRouter ni Workers AI.
- El Worker no impone `maxSpendUsd`. La reserva del puerto real solo comprueba que la llamada pueda empezar. No es un tope de gasto.
- Siguen sin sonda de BGE-M3, sin índice, sin ingesta y sin umbral semántico. El 0,33 no se traslada.
- La comparación de veinte preguntas, los materiales de clase y el ensayo quedan fuera.
- No hubo commit, push ni despliegue. OpenViking sigue sin cuenta para este directorio.

El diagrama está en `docs/crag-graph.md`. El recorrido de clase está en `docs/crag-demo-walkthrough.md`.
