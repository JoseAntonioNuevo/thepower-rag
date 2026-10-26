# Zocomar en el chat de producción (25 de octubre de 2026)

El usuario autorizó en la cuenta `9c1493e94ba21f2c6872a9dd17ba19f7` cuatro pasos: crear el índice Vectorize `thepower-ai-course-rag-eb8d9e84d3ba` con sus índices de metadatos, ingerir Zocomar y calibrar su umbral con hasta 0,05 USD de embeddings, desplegar producción con `CHAT_CORPUS=zocomar` y probar dos turnos RAG y dos CRAG. Los recibos locales están en `activation-receipts/zocomar/` (ignorado por Git).

## Índice, ingesta y calibración

- Índice `thepower-ai-course-rag-eb8d9e84d3ba`: BGE-M3, 1024 dimensiones, cosine, con los índices de metadatos `corpusVersion`, `audience` y `profileId` visibles antes de ingerir.
- Corpus `cb7dabfb11854` (contenido `cbb8eb3cb881c`): 12 políticas y 54 fragmentos. La ingesta escribió R2, D1 y Vectorize y se leyó de vuelta. El primer lote quedó `pending-visibility`; `resume --profile=peb8d9e84d3ba` lo confirmó sin reenviarlo.
- D1 tras la ingesta: el perfil del curso `p76509a5f9743` sigue `ready` y activo con 69/69; el de Zocomar `peb8d9e84d3ba` está `ready` con 54/54 y no activo (el chat lo elige por `STORE_INDEX_PROFILE`, no por la marca de activo).
- Calibración con las seis preguntas de validación del laboratorio (cuatro con respuesta y dos sin ella), nunca con las de demostración ni las del test: positiva mínima 0,7357, negativa máxima 0,5882, recall de desarrollo 1. Umbral `STORE_MIN_RETRIEVAL_SCORE = 0.661926`, punto medio con separación.
- Gasto reservado de embeddings: 0,00089385 USD de los 0,05 autorizados. Es una reserva con tarifa conocida, no la factura de Workers AI.

## Despliegue

- Antes: versión `dc051851-8cd1-41d0-96f5-21843c62ca4e` (deployment `ef13fc2f-976b-4190-9368-ad71754a162f`).
- `check`, 363 pruebas unitarias y 6 de entrada contra workerd en verde con la configuración final. Build de producción con hash de `index.js` `f8ef5f455d6029dd1ed64dacd7fa572249a0bc45d395a5ebd24f144489b0057a`.
- El dry-run y la comparación con la versión publicada solo cambian `CHAT_CORPUS`, `STORE_CORPUS_VERSION`, `STORE_INDEX_PROFILE`, `STORE_MIN_RETRIEVAL_SCORE`, el binding `VECTORIZE_STORE` y `RAG_CONTEXT_MODE` de `complete` a `semantic`. La tienda no admite contexto completo, y la comparación RAG/CRAG de S11 necesita que RAG básico busque.
- Después: versión `faa8a19c-3254-470a-b51b-54f44f00089c`, deployment `4315ee3f-e258-4110-a73a-8c16ed835417`, 100 % del tráfico. El código es `1908e50` más los cambios del segundo corpus aún sin commit.
- `/api/health`: las cuatro etapas `ready`. `chatCorpus` es `zocomar` (`cb7dabfb11854`, `peb8d9e84d3ba`, umbral 0,661926, sin grupos, `index-verified`). El corpus del curso sigue `index-verified` con `c3a59a406888b`/`p76509a5f9743`, y es el que lee la investigación de S12.

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
- `/api/health` (200): las cuatro etapas `ready`; `modelConfiguration` con generador `claude-haiku-5-5`, evaluador `claude-sonnet-5-5`, investigación `claude-haiku-5-5`, 60 s por turno CRAG, 30 s por llamada, modo `semantic` y umbral 0,661926. El chat lee Zocomar `index-verified` y el curso sigue `index-verified`.
- El cliente servido (`assets/index-B8_poPOS.js`) es el del build local.
- No se hicieron turnos de chat tras este despliegue: no hay respuestas de Haiku verificadas todavía.

Recibos en `activation-receipts/zocomar/haiku/`.

## Modo clase publicado (26 de octubre de 2026)

Con autorización expresa del usuario se publicó el modo clase, con el grafo en directo de RAG y CRAG y la repetición paso a paso (`docs/decisions.md`). Antes de publicar pasaron `check`, 377 pruebas unitarias, 6 de entrada y el build de producción (hash de `index.js` `97cc32030872ce61a64667d6488a585eed9aecce9e6388ad7df78c73a8447335`). En el navegador se probaron un turno RAG y el guion CRAG de evidencia parcial con la demo local. El dry-run frente a `35d435a0` no cambia ninguna variable ni ningún binding: solo cambia el código.

- Antes: deployment `3ae79f1c-bb1a-4cef-a5f9-8ac1f0855c9c`, versión `35d435a0-8f36-4c6b-8051-73cfae84456b`.
- Después: deployment `75a19b23-bf0e-4518-a4a5-ba0ea353a0b3`, versión `cfbccfcf-735b-42bd-8800-128b2622545e`, 100 % del tráfico.
- `/api/health` (200): las cuatro etapas `ready`; generador `claude-haiku-5-5`, evaluador `claude-sonnet-5-5`, 60 s por turno CRAG, modo `semantic`, umbral 0,661926; Zocomar y el curso `index-verified`.
- El cliente servido (`assets/index-zamdhd_U.js`) es el del build y contiene el modo clase. La web publicada con `?clase` dibuja el grafo de CRAG con Claude Sonnet 5.5 en el juez y la reformulación y con Claude Haiku 5.5 en la respuesta. No se enviaron preguntas: las pruebas con turnos reales las hace el usuario desde su navegador.

Recibos en `activation-receipts/zocomar/clase/`.
