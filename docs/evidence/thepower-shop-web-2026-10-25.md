# ThePower Shop en el chat de producción (25 de octubre de 2026)

> Nota del 26/10/2026: la tienda se renombró de «Zocomar» a «ThePower Shop». Los textos de esta evidencia usan el nombre nuevo. Los ids, hashes, versiones y rutas registrados en las ejecuciones (por ejemplo `09-zocomar-plus` o `cb7dabfb11854`) son los del corpus de entonces y no se han cambiado.

El usuario autorizó en la cuenta `9c1493e94ba21f2c6872a9dd17ba19f7` cuatro pasos: crear el índice Vectorize `thepower-ai-course-rag-eb8d9e84d3ba` con sus índices de metadatos, ingerir ThePower Shop y calibrar su umbral con hasta 0,05 USD de embeddings, desplegar producción con `CHAT_CORPUS=thepower-shop` y probar dos turnos RAG y dos CRAG. Los recibos locales están en `activation-receipts/thepower-shop/` (ignorado por Git).

## Índice, ingesta y calibración

- Índice `thepower-ai-course-rag-eb8d9e84d3ba`: BGE-M3, 1024 dimensiones, cosine, con los índices de metadatos `corpusVersion`, `audience` y `profileId` visibles antes de ingerir.
- Corpus `cb7dabfb11854` (contenido `cbb8eb3cb881c`): 12 políticas y 54 fragmentos. La ingesta escribió R2, D1 y Vectorize y se leyó de vuelta. El primer lote quedó `pending-visibility`; `resume --profile=peb8d9e84d3ba` lo confirmó sin reenviarlo.
- D1 tras la ingesta: el perfil del curso `p76509a5f9743` sigue `ready` y activo con 69/69; el de ThePower Shop `peb8d9e84d3ba` está `ready` con 54/54 y no activo (el chat lo elige por `STORE_INDEX_PROFILE`, no por la marca de activo).
- Calibración con las seis preguntas de validación del laboratorio (cuatro con respuesta y dos sin ella), nunca con las de demostración ni las del test: positiva mínima 0,7357, negativa máxima 0,5882, recall de desarrollo 1. Umbral `STORE_MIN_RETRIEVAL_SCORE = 0.661926`, punto medio con separación.
- Gasto reservado de embeddings: 0,00089385 USD de los 0,05 autorizados. Es una reserva con tarifa conocida, no la factura de Workers AI.

## Despliegue

- Antes: versión `dc051851-8cd1-41d0-96f5-21843c62ca4e` (deployment `ef13fc2f-976b-4190-9368-ad71754a162f`).
- `check`, 363 pruebas unitarias y 6 de entrada contra workerd en verde con la configuración final. Build de producción con hash de `index.js` `f8ef5f455d6029dd1ed64dacd7fa572249a0bc45d395a5ebd24f144489b0057a`.
- El dry-run y la comparación con la versión publicada solo cambian `CHAT_CORPUS`, `STORE_CORPUS_VERSION`, `STORE_INDEX_PROFILE`, `STORE_MIN_RETRIEVAL_SCORE`, el binding `VECTORIZE_STORE` y `RAG_CONTEXT_MODE` de `complete` a `semantic`. La tienda no admite contexto completo, y la comparación RAG/CRAG de S11 necesita que RAG básico busque.
- Después: versión `faa8a19c-3254-470a-b51b-54f44f00089c`, deployment `4315ee3f-e258-4110-a73a-8c16ed835417`, 100 % del tráfico. El código es `1908e50` más los cambios del segundo corpus aún sin commit.
- `/api/health`: las cuatro etapas `ready`. `chatCorpus` es `thepower-shop` (`cb7dabfb11854`, `peb8d9e84d3ba`, umbral 0,661926, sin grupos, `index-verified`). El corpus del curso sigue `index-verified` con `c3a59a406888b`/`p76509a5f9743`, y es el que lee la investigación de S12.

## Pruebas en producción

Turnstile no se completa en el navegador automatizado del agente (error 600010, que Cloudflare emite cuando detecta automatización), igual que en el ensayo instrumentado del 23/10. El envío pendiente se canceló antes de llegar a `/api/chat`. El usuario hizo las pruebas desde su navegador y confirmó que funcionan.

El registro de `wrangler tail`, filtrado a hora, método, ruta y estado, sin cabeceras, IP ni cuerpos, recoge dos `POST /api/chat` con 200 y sin excepciones. El contador público pasó de 118 a 120 turnos y su reserva subió 1,050118 USD, que es exactamente un turno RAG (0,1500295) más uno CRAG (0,9000885). Se completaron, por tanto, un turno de cada etapa y no los dos de cada una que cubría la autorización. El texto de las respuestas no se guardó en este recibo.

## Qué enseñan ya las puntuaciones de producción

Con BGE-M3 y el umbral 0,661926, en las cuatro preguntas de validación con respuesta solo **un** fragmento supera el corte (0,736, 0,757, 0,817 y 0,770); el segundo mejor queda entre 0,50 y 0,63. RAG básico, por tanto, pasa al generador un único fragmento por pregunta. Una respuesta que necesite dos documentos, como el reembolso de una devolución pagada con Bizum (devoluciones más pagos), depende de que CRAG valore los diez candidatos, conserve el parcial y vuelva a buscar. En el laboratorio, con otro modelo de embeddings y otro umbral, RAG y CRAG empataron en acierto. En producción falta medirlo con el test reservado.

## Presupuesto público

`public_budget.reserved_usd` vale −42,8496165 antes de las pruebas y −41,7994985 después. El tope del Worker sigue en 4,30 USD, pero el contador negativo deja unos 46 USD de margen de reserva. `docs/decisions.md` registraba el 18/10 un saldo de 0,628 USD que bloqueaba CRAG. El contador ya era negativo el 23/10 y este repositorio no documenta ese ajuste. No se ha modificado.

## Generador Haiku y evaluador Sonnet (26 de octubre de 2026)

Con autorización expresa del usuario se publicó el reparto descrito en `docs/decisions.md`: `MODEL_ID=claude-haiku-5-5` con tarifas 0,1/0,5 USD por MTok y `EVALUATOR_MODEL_ID=claude-sonnet-5-5` con 2/10. Antes de publicar pasaron `check`, 363 pruebas unitarias, 6 de entrada, el build de producción (hash de `index.js` `7ee879341ce89d0e02bf10aca1747fab2906923750a66388d60d76cbb3d6b8d3`) y el dry-run. Frente a `faa8a19c` solo cambian `MODEL_ID`, `MODEL_INPUT_USD_PER_MILLION` y `MODEL_OUTPUT_USD_PER_MILLION`.

- Antes: deployment `4315ee3f-e258-4110-a73a-8c16ed835417`, versión `faa8a19c-3254-470a-b51b-54f44f00089c`.
- Después: deployment `3ae79f1c-bb1a-4cef-a5f9-8ac1f0855c9c`, versión `35d435a0-8f36-4c6b-8051-73cfae84456b`, 100 % del tráfico.
- `/api/health` (200): las cuatro etapas `ready`; `modelConfiguration` con generador `claude-haiku-5-5`, evaluador `claude-sonnet-5-5`, investigación `claude-haiku-5-5`, 60 s por turno CRAG, 30 s por llamada, modo `semantic` y umbral 0,661926. El chat lee ThePower Shop `index-verified` y el curso sigue `index-verified`.
- El cliente servido (`assets/index-B8_poPOS.js`) es el del build local.
- No se hicieron turnos de chat tras este despliegue: no hay respuestas de Haiku verificadas todavía.

Recibos en `activation-receipts/thepower-shop/haiku/`.

## Modo clase publicado (26 de octubre de 2026)

Con autorización expresa del usuario se publicó el modo clase, con el grafo en directo de RAG y CRAG y la repetición paso a paso (`docs/decisions.md`). Antes de publicar pasaron `check`, 377 pruebas unitarias, 6 de entrada y el build de producción (hash de `index.js` `97cc32030872ce61a64667d6488a585eed9aecce9e6388ad7df78c73a8447335`). En el navegador se probaron un turno RAG y el guion CRAG de evidencia parcial con la demo local. El dry-run frente a `35d435a0` no cambia ninguna variable ni ningún binding: solo cambia el código.

- Antes: deployment `3ae79f1c-bb1a-4cef-a5f9-8ac1f0855c9c`, versión `35d435a0-8f36-4c6b-8051-73cfae84456b`.
- Después: deployment `75a19b23-bf0e-4518-a4a5-ba0ea353a0b3`, versión `cfbccfcf-735b-42bd-8800-128b2622545e`, 100 % del tráfico.
- `/api/health` (200): las cuatro etapas `ready`; generador `claude-haiku-5-5`, evaluador `claude-sonnet-5-5`, 60 s por turno CRAG, modo `semantic`, umbral 0,661926; ThePower Shop y el curso `index-verified`.
- El cliente servido (`assets/index-zamdhd_U.js`) es el del build y contiene el modo clase. La web publicada con `?clase` dibuja el grafo de CRAG con Claude Sonnet 5.5 en el juez y la reformulación y con Claude Haiku 5.5 en la respuesta. No se enviaron preguntas: las pruebas con turnos reales las hace el usuario desde su navegador.

Recibos en `activation-receipts/thepower-shop/clase/`.

## Modo lento publicado (26 de octubre de 2026)

Con autorización expresa del usuario se publicaron el modo lento del grafo, la línea de pasos, la arista de llegada y la explicación por nodo. Antes pasaron `check`, 380 pruebas unitarias y el build. En la demo local, el modo lento avanzó exactamente cada 3,5 s en RAG; en el guion CRAG de segunda búsqueda iba por el paso 3 de 9 a los 8 s y, al apagar el interruptor, saltó al 9 de 9. No hubo errores de consola. El dry-run frente a `cfbccfcf` no cambia variables ni el código del Worker (mismo hash de `index.js`); solo cambia el cliente.

- Antes: deployment `75a19b23-bf0e-4518-a4a5-ba0ea353a0b3`, versión `cfbccfcf-735b-42bd-8800-128b2622545e`.
- Después: deployment `935edaa5-400f-41b4-b6bb-e4d7a2b9f327`, versión `17692356-cfb8-4621-9215-2feabf76b6ad`, 100 % del tráfico.
- `/api/health` (200): las cuatro etapas `ready`, Haiku 5.5 genera y Sonnet 5.5 evalúa, y ThePower Shop y el curso están `index-verified`. El cliente servido (`assets/index-DqmgO5mF.js`) es el del build y contiene el modo lento.

Recibos en `activation-receipts/thepower-shop/lento/`.

## Nombres legibles y guía por paso publicados (26 de octubre de 2026)

Con autorización expresa del usuario se publicaron los nombres legibles de los fragmentos (documento › sección · fragmento N, con el id en el tooltip) y la guía «Cómo leer este paso». Antes pasaron `check`, 385 pruebas unitarias, 6 de entrada y el build (hash de `index.js` `fbe6df12a86b003e41bec31020d5489e7b9da6177ea3bd8703699b8e887ba05b`). En la demo local se comprobaron con RAG y con CRAG, sin errores de consola. El dry-run frente a `17692356` no cambia variables; cambian el Worker (los candidatos llevan `title` y `section`) y el cliente.

- Antes: deployment `935edaa5-400f-41b4-b6bb-e4d7a2b9f327`, versión `17692356-cfb8-4621-9215-2feabf76b6ad`.
- Después: deployment `2818ad5f-ff1c-4869-aa75-cf5eae418827`, versión `758f276d-65f4-4bf8-94e8-ae9eac8c7dfe`, 100 % del tráfico.
- `/api/health` (200): las cuatro etapas `ready`, Haiku 5.5 genera y Sonnet 5.5 evalúa, y ThePower Shop y el curso están `index-verified`. El cliente servido (`assets/index-io0DmSXx.js`) es el del build y contiene la guía.

Recibos en `activation-receipts/thepower-shop/nombres/`.

## ThePower Shop publicado (26 de octubre de 2026)

Con autorización expresa del usuario se creó el índice `thepower-ai-course-rag-3d2b914bd60c`, con sus metadatos `corpusVersion`, `audience` y `profileId`. Se ingirió el corpus renombrado `cc140d7876624` (contenido `c907bd93cf7af`, 54 fragmentos) y se leyó de vuelta: el perfil `p3d2b914bd60c` queda `ready` con 54/54 vectores, sin activar, porque el activo sigue siendo el del curso. La calibración dio 0,68771. Se reservaron 0,00071685 USD de embeddings en la ingesta y la calibración, y 0,000118 USD en la medición de los cuatro casos.

- Antes: deployment `2818ad5f-ff1c-4869-aa75-cf5eae418827`, versión `758f276d-65f4-4bf8-94e8-ae9eac8c7dfe`.
- Después: deployment `93fe07ab-479c-4d29-b564-f8baea459070`, versión `caf33c27-69ff-4774-9355-60fd4bf81609`, 100 % del tráfico. Respecto a la versión anterior solo cambiaron `CHAT_CORPUS`, `STORE_CORPUS_VERSION`, `STORE_INDEX_PROFILE`, `STORE_MIN_RETRIEVAL_SCORE` y el índice de `VECTORIZE_STORE`. El código incluye además la biblioteca de documentos, que entró en este despliegue y el usuario decidió mantener publicada (hash de `index.js` `3b96b2bf81668f9f94e2188fb997b85e620913bfd6eeeea1676c38cc66cb4648`).
- `/api/health` (200): las cuatro etapas `ready`. `chatCorpus` es `thepower-shop` («ThePower Shop, tienda en línea ficticia», `cc140d7876624`, `p3d2b914bd60c`, umbral 0,68771, `index-verified`); el curso sigue `index-verified`. `/api/corpus` devuelve desde D1 las 12 políticas, empezando por «Qué es ThePower Shop y cómo funciona el marketplace». El cliente servido (`assets/index-Bd9ZoSMw.js`) es el del build.

El laboratorio se reconstruyó con el texto nuevo (versión `lab-0d7f87fe2504`, 54 vectores) y se recalibró en 0,752989 dentro del diario `lab/.local/thepower-shop`, que queda en 2,7838392 de 5 USD reservados. No se hicieron turnos de chat tras este despliegue. Recibos en `activation-receipts/thepower-shop/renombre/`.
