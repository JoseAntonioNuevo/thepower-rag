# Registro de capturas

Todas las imágenes de `capturas/` se tomaron el 3 de octubre de 2026 contra `http://localhost:5173/`, con `bun run dev` y `APP_MODE=demo`.

Procedencia común, leída en el banner de cada captura:

- Ejecución: `demo`
- Familia: `fixture`
- Corpus: `c3a59a406888b`
- Embedding: `fixture-token-hash-v1`
- Remoto: no verificado

No son capturas del día de la clase ni del índice Vectorize. Si el 22 o el 27 la pantalla difiere, manda la pantalla de ese día y estas imágenes quedan como respaldo fechado.

| Archivo                                       | Qué demuestra                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `2026-10-03-demo-fixture-apertura.png`        | Página recién abierta, antes de preguntar                                 |
| `2026-10-03-demo-fixture-sin-rag.png`         | Sin RAG, stream local, sin fuentes, uso no medido                         |
| `2026-10-03-demo-fixture-rag-citas.png`       | RAG básico, General, citas S5 y S14, `offline-fixture`                    |
| `2026-10-03-demo-fixture-rag-rechazo.png`     | RAG básico rechaza la beca de 1991                                        |
| `2026-10-03-demo-fixture-rag-mj-s10.png`      | Cohorte M/J, fecha 2026-10-22, fuente `calendario-mj:10`                  |
| `2026-10-03-demo-fixture-crag-suficiente.png` | Guion suficiente, audiencia General                                       |
| `2026-10-03-demo-fixture-crag-parcial.png`    | Guion parcial, fuentes S5 y S6, audiencia General                         |
| `2026-10-03-demo-fixture-crag-descartada.png` | Guion de primera evidencia descartada, audiencia General                  |
| `2026-10-03-demo-fixture-crag-ausente.png`    | Guion de dato ausente, 3 búsquedas y 2 reformulaciones, audiencia General |
| `2026-10-03-demo-fixture-crag-cohorte.png`    | Guion de calendario, 0 búsquedas, audiencia General                       |
| `2026-10-03-demo-fixture-crag-error.png`      | Fallo controlado del evaluador, audiencia General                         |
| `2026-10-03-demo-fixture-crag-libre.png`      | Pregunta libre de modelos abiertos. El índice es lexical                  |

La traza larga puede quedar bajo el pliegue en una captura de 900 px. El guion pide hacer scroll en clase. Los PNG de CRAG posteriores se tomaron a 1100 px de alto para dejar más panel a la vista.

## Pendiente, sin imagen porque no ocurrió

- Sonda BGE-M3 y dimensión observada.
- Índice Vectorize con métrica y umbral calibrados.
- Respuesta de OpenRouter.
- Ingesta remota y perfil activo.
- Tabla de las veinte preguntas.
- Despliegue público.
