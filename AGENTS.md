# thepower-rag

Asistente de curso en español para AI Engineer. La fase 7 conecta el CLI con el Worker del puente. La fase 6 dejó el plazo, la ordenación y el presupuesto de sesión. El corpus de alumno cubre S1 a S20. La demo recorre el grafo con guiones. Desde el 3 de octubre de 2026 está desplegado y verificado en `rag-thepower.josenuevo.dev`; el estado y los límites están en `docs/despliegue-real.md`.

Las clases previstas son S10 (22 de octubre de 2026, sin RAG y RAG básico) y S11 (27 de octubre de 2026, CRAG sobre la misma aplicación). S12 añade la investigación con fuentes externas, imagen, audio y voz sobre el mismo proyecto.

`CLAUDE.md` es un enlace a este archivo, no una copia. Si cambias el contrato, cambia solo `AGENTS.md`.

## Para qué sirve este archivo

Es el contrato del proyecto para cualquier agente de IA (Claude Code, Cursor, Codex…). Lo leen dos tipos de usuario:

- **Alumnos del curso** que abren el repositorio y preguntan a la IA cómo funciona algo («¿qué hace CRAG cuando la evidencia es parcial?», «¿dónde se reserva el presupuesto?»). La IA debe poder responder con la ruta exacta del archivo, el porqué del diseño y el flujo completo, sin inventar.
- **Agentes que modifican el código.** Deben respetar las reglas de aislamiento, gasto y verificación de abajo.

Cada archivo de código empieza con un bloque `// GUÍA DE LECTURA · ruta` que resume qué hace y por qué. Casi cada instrucción lleva un comentario en español encima. Para explicar una pieza, lee primero esa guía y después los comentarios del cuerpo; este documento da el mapa y las decisiones transversales.

## Aislamiento

Editar solo este directorio. `1-langGraph`, `2-modelos` y `kanban` son proyectos independientes. No copiar sus invariantes, cuentas ni archivos de entorno. La guía del directorio padre es una fuente parcial de solo lectura.

El usuario autorizó el 3 de octubre de 2026 montar y desplegar este proyecto en `rag-thepower.josenuevo.dev`, con hasta 5 USD para puesta en marcha. La ejecución quedó documentada en `docs/despliegue-real.md`. No ampliar recursos, dominios, presupuesto, planes ni suscripciones sin nueva autorización. Un build local no es un despliegue. `APP_MODE=real`, un login de Wrangler o un archivo generado por el agente no autorizan un alta ni un gasto. La cuenta de destino, leída en whoami, es la de joseantonionuevo@gmail.com, nombre `Joseantonionuevo@gmail.com's Account`, id `9c1493e94ba21f2c6872a9dd17ba19f7`. Esa identidad no incluye tope de gasto, `MODEL_ID` ni permiso para crear recursos o cambiar de plan.

`bun run activate` y `bun run activate -- plan` no llaman a la red. `bun run activate -- status --read` solo lee esa cuenta y los tres nombres del curso. `--execute` llama a Wrangler únicamente si `apps/web/.activation.json` trae el permiso de esa operación y un tope que cubre el coste estimado. No se cambia el perfil global de autenticación ni se lee el llavero.

La investigación de S12 tiene su propia autorización: 1 USD en total y 0,25 USD por trabajo, separados del presupuesto del chat (`docs/s12-cloud-deployment.md`). No reutilizar uno para el otro.

Cuando un alumno pregunte, la IA explica y señala archivos. No ejecuta comandos que gasten (`--execute`, `dev:real`, `compare-live`, `evaluate-*`, `calibrate-live`, `wrangler deploy`, `wrangler secret`) ni toca producción.

## Qué hace la aplicación

Un único Worker de Cloudflare sirve la interfaz React y la API Hono en el mismo origen. El alumno elige una **etapa** y un **grupo** y conversa con el asistente del curso.

| Etapa         | Qué enseña                                                                                                                            | Dónde está la lógica                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Sin RAG       | El modelo responde sin documentos: no cita y puede no saber datos del curso.                                                          | `apps/api/src/app.ts` (rama `sin-rag`), `prompts.ts`                                        |
| RAG básico    | Recuperar contexto del curso, responder con citas `[cite:id]` o rechazar sin llamar al modelo.                                        | `app.ts` (rama `rag`), `course-context.ts`, `packages/rag/src/pipeline.ts`, `calendar.ts`   |
| CRAG          | RAG correctivo: evaluar la evidencia, conservar o descartar, reformular y volver a buscar con límites estrictos.                      | `crag-http.ts`, `crag-graph.ts`, `crag-real.ts`, `crag-demo.ts`, `packages/rag/src/crag.ts` |
| Investigación | Plan con subpreguntas, curso + herramienta + web en dominios permitidos, informe verificado de forma extractiva, imagen, audio y voz. | `research-*.ts` de `apps/api`, `packages/research`, `apps/web/src/research-desk.tsx`        |

Grupos (`audience`): `program` (contenido común, sin calendarios), `L/X` (lunes y miércoles) y `M/J` (martes y jueves). Cada grupo lee el programa y **solo su calendario**. El filtro se aplica en la consulta, no solo en el prompt. Una pregunta de horario sin grupo pide aclaración y no gasta.

Corpus del chat (`CHAT_CORPUS`, `apps/api/src/chat-corpus.ts`): `course` (por defecto) o `zocomar`, la tienda ficticia del laboratorio (`corpus/zocomar/sources/`, preparada en `corpus/prepared/zocomar.json` con `bun scripts/prepare-corpus.ts --corpus zocomar`). Con `zocomar`, Sin RAG, RAG básico y CRAG usan sus prompts, `STORE_CORPUS_VERSION`, `STORE_INDEX_PROFILE`, `STORE_MIN_RETRIEVAL_SCORE` y el binding `VECTORIZE_STORE`; no hay grupos, ni aclaración de calendario, ni contexto completo. La investigación de S12 **siempre** lee el curso (`CORPUS_VERSION`, `INDEX_PROFILE`, `VECTORIZE`, `corpus/prepared/corpus.json`); `scripts/chat-corpus-isolation.test.ts` lo comprueba. Desde el 25/10/2026 producción usa la tienda: índice `thepower-ai-course-rag-eb8d9e84d3ba` (perfil `peb8d9e84d3ba`, 54 vectores, no activo en D1 porque el perfil activo es el del curso), umbral calibrado 0,661926; publicada en la versión `faa8a19c-3254-470a-b51b-54f44f00089c` y, con Haiku como generador, en `35d435a0-8f36-4c6b-8051-73cfae84456b`. Recibos en `activation-receipts/zocomar/`, evidencia en `docs/evidence/zocomar-web-2026-10-25.md`. Volver al curso es `CHAT_CORPUS=course` con `RAG_CONTEXT_MODE` a elección, y exige un despliegue autorizado. Los scripts de activación y `calibrate-live.ts` aceptan `--corpus=zocomar` y escriben en `activation-receipts/zocomar/`; con la tienda no se ejecutan `select-active`, `migrate`, `probe-embeddings` ni `verify`.

Modos de ejecución (`APP_MODE`):

- `demo` (por defecto en `bun run dev`): sin red ni claves. Sin RAG es un stream etiquetado; RAG usa un índice léxico de 128 dimensiones (`fixture-token-hash-v1`, umbral 0,33) que **no** es semántico ni Vectorize; CRAG e investigación usan guiones.
- `real`: proveedor de modelos, Workers AI, Vectorize, D1 y R2. Si falta configuración, la API responde 409 y **nunca** cae a la demo.

## Mapa del repositorio

```text
3-rag/
├── AGENTS.md (CLAUDE.md → enlace)   Contrato para agentes (este archivo)
├── README.md                         Guía de uso, proveedores y estado publicado
├── package.json                      Workspaces de Bun y scripts (bun run …)
├── vite.config.ts                    Vite+: formato, lint con tipos y tests del monorepo
├── tsconfig*.json                    TypeScript estricto común y por paquete
├── .env.example                      Plantilla de claves del proveedor (sin secretos)
├── apps/
│   ├── api/                          Worker: Hono, grafos LangGraph, adaptadores de Cloudflare
│   │   ├── src/                      Código de la API (ver tabla de archivos)
│   │   ├── migrations/               SQL del D1 del curso (catálogo, perfiles, diario, presupuesto)
│   │   ├── migrations-research/      SQL del D1 de la investigación (cuenta, trabajos, medios)
│   │   └── fixtures/media/           Imagen y audio sintéticos para pruebas (manifest.json dice su origen)
│   └── web/                          React 19 + Vite + plugin de Cloudflare
│       ├── index.html                Página única
│       ├── wrangler.jsonc            Configuración del Worker y entornos (demo, production, local, research)
│       ├── vite.config.ts            Vite de la web y servidor local en 127.0.0.1
│       └── src/                      Interfaz (ver tabla de archivos)
├── packages/
│   ├── contracts/                    Esquemas Zod y límites compartidos (navegador, API y scripts)
│   ├── rag/                          Núcleo RAG puro: troceado, ingesta, recuperación, CRAG, presupuesto
│   └── research/                     Lógica pura de la investigación: plan, evidencia, política, verificación
├── scripts/                          CLI de Bun: preparar corpus, preflight, activación, verificación, evaluaciones
├── corpus/
│   ├── sources/program/              20 fichas Markdown del temario (S1–S20)
│   ├── sources/cohorts/              Calendarios L/X y M/J
│   ├── prepared/corpus.json          Corpus preparado y troceado (lo genera prepare-corpus; lo empaqueta el Worker)
│   └── COVERAGE.md                   Cobertura generada (temario, calendarios, ejercicios)
├── docs/                             Arquitectura, decisiones, fases, despliegue y evidencias
├── lab/                              Laboratorio reproducible S10/S11 (PostgreSQL + pgvector 768 + HNSW, 10 docs ficticios, CRAG y evaluación 14+6)
├── material/                         Paquete docente de S10/S11 (guiones, ejercicios, presentaciones, comparación)
└── prompts/                          Encargos históricos con los que se construyó cada fase (solo lectura)
```

`activation-receipts/`, `apps/web/.wrangler/`, `.dev.vars*`, `.env` y `.activation.json` son estado local ignorado por Git.

## Arquitectura

```text
navegador (React, useChat del AI SDK)
   │  POST /api/chat · GET /api/health · /api/research/* · GET /api/security
   ▼
Worker (apps/api/src/worker.ts o research-worker.ts)
   ├── /api/security      configuración pública de Turnstile (chat-protection.ts)
   ├── /api/health        capacidades por etapa (env.ts → assessWorker)
   ├── /api/chat          sin RAG · RAG · CRAG · investigación en primer plano (app.ts)
   ├── /api/research/*    investigación durable: conversaciones, trabajos, medios (research-routes.ts)
   └── assets             build de React (single-page-application)
         │
         ├── Workers AI   embeddings BGE-M3 (1024 dim.), Whisper y Aura-2
         ├── Vectorize    índice del perfil activo (cosine)
         ├── D1 DB        catálogo del corpus, perfiles, diario de ingesta, presupuesto público
         ├── R2 CORPUS    documentos y manifiestos del corpus
         ├── D1 RESEARCH_DB, R2 RESEARCH_MEDIA, Workflow RESEARCH_WORKFLOW   (solo investigación)
         └── Proveedor LLM  createLanguageModel (Anthropic por defecto; también OpenAI, OpenRouter, Gemini, compatible)
```

Límites de código: `packages/*` no importa bindings, Bun ni Node; el navegador solo importa `packages/contracts`. Los adaptadores de Cloudflare viven en `apps/api` y no llaman a la red al importarse ni al construirse. La lógica que decide (umbrales, validadores, topes) es pura y se prueba sin red.

### Recorrido de `POST /api/chat` (`apps/api/src/app.ts`)

1. **Protección** (`chat-protection.ts`): en real público exige origen permitido, sesión anónima firmada (cookie `__Host-`), token de Turnstile y cupos (6 peticiones/60 s por sesión, 120/60 s por red). En local y demo no se aplica.
2. **Cuerpo**: tamaño máximo, JSON válido y esquema `chatRequestSchema` (`packages/contracts/src/chat.ts`). El historial solo lleva texto.
3. **Capacidades** (`env.ts → assessWorker`): decide qué etapas están `ready`, `blocked` u `offline-*`. Nunca llama a la red.
4. **Investigación** (`mode: "research"`): si hay Workflow configurado responde 409 y remite a `/api/research`; si no, ejecuta el grafo en primer plano (`research-http.ts`).
5. **Presupuesto público** (`public-budget.ts`): en real reserva el peor caso del turno con un `UPDATE` condicional en D1. Si no cabe: 429.
6. **CRAG** (`crag-http.ts`): construye puertos (demo, aclaración o reales), ejecuta el grafo y emite pasos, resumen, fuentes y respuesta.
7. **Sin RAG**: demo → `demo-stream.ts`; real → `streamProviderCourseResponse` con `SIN_RAG_PROMPT`.
8. **RAG básico**: demo → índice léxico; real → `RAG_CONTEXT_MODE=complete` (todo el curso del grupo desde D1, `course-context.ts`), atajo de calendario semanal (`packages/rag/src/calendar.ts`) o búsqueda vectorial (`vectors.ts` + `stores.ts`). Después `retrieveBasic`/umbral decide `answer`, `refuse` o `clarify`. Rechazar o aclarar **no** llama al modelo.
9. **Respuesta** (`course-stream.ts`): stream del protocolo UI Message del AI SDK con texto, partes `data-source`, `data-trace`, `data-crag`… y metadatos de consumo y coste. Las citas `[cite:id]` se validan contra la evidencia permitida.

Códigos: 400 cuerpo inválido, 403 protección, 409 configuración incompleta o perfil no listo, 429 cupo o presupuesto, 499 cancelado, 502 fallo del proveedor (mensaje público sin detalles).

## Etapas en detalle

### Sin RAG

Una llamada `streamText` con `SIN_RAG_PROMPT` (`prompts.ts`). No hay fuentes ni filtro de citas. Sirve para que el alumno vea lo que el modelo no sabe del curso.

### RAG básico

- Corpus: `bun run prepare-corpus` lee `corpus/sources`, valida la cabecera de cada Markdown, trocea en fragmentos de 900 caracteres con 80 de solapamiento (`packages/rag/src/chunk.ts`) y calcula ids estables a partir del contenido (`ids.ts`, `hash.ts`). Preparación actual `c3a59a406888b`.
- Referencia principal de S10 (`RAG_CONTEXT_MODE=semantic` en `apps/web/wrangler.jsonc`): embedding BGE-M3 de la pregunta, vecinos en Vectorize filtrados por versión, perfil y grupo, texto de D1 y umbral `MIN_RETRIEVAL_SCORE` (`0,5` calibrado con preguntas de desarrollo en `scripts/calibrate-live.ts`). Si ningún fragmento supera el corte, rechaza antes de llamar al modelo generativo.
- Variante de contexto completo (`RAG_CONTEXT_MODE=complete`): el corpus del curso (unos 23 000 caracteres) cabe entero en D1; lee todos los fragmentos del programa más el calendario del grupo y comprueba que coinciden con el manifiesto (máximo 200 fragmentos y 32 000 caracteres). Se enseña después del recorrido semántico como variante para corpus pequeños (`docs/rag-contexto-completo.md`).
- El perfil de índice tiene que estar `ready`, ser el mismo modelo, dimensión y métrica `cosine`. Si no: 409, sin embeber.
- Laboratorio del ejercicio (`lab/`): `bun run lab:real` usa PostgreSQL local/pgvector, `vector(768)`, HNSW, embeddings reales y generación real. La conexión se limita a localhost:54329/aether_rag. Desde el 24/10/2026 el corpus es **Zocomar**, un marketplace inventado (12 políticas, 54 fragmentos, `lab/corpus/sources/`); AetherCloud queda archivado en `lab/corpus/aethercloud-s10/` con su ensayo de S10 (calibración 0,724767, test 9/14 y 6/6, sin reajuste). Para S11, `crag`, `compare`, `demo` y `eval` ejecutan CRAG con juez real (mismo modelo que el generador; los umbrales deciden en código) sobre el mismo índice; su estado y su diario de gasto están en `lab/.local/zocomar/`. Validación (6), demostración (6) y test (20) están en `lab/src/evaluation.ts` y son disjuntos. Test real del 24/10 (umbral 0,722598): RAG 14/14 y 6/6, CRAG 14/14 y 6/6; CRAG gana margen (0,65 frente a 0,014) y contexto limpio, no corrección, a ×2,8 de latencia en respondibles (`docs/evidence/zocomar-lab-2026-10-24.md`). `lab:demo` y `lab:eval` son respaldo léxico/extractivo; no acreditan una comparación CRAG real. El guion canónico de 24 diapositivas está en `material/guiones/S10-guion-profesor.md`, con 30+50+10 y QR actualizado del 19/10. No añadir paquetes PostgreSQL al Worker: el CLI usa SQL nativo de Bun.

### CRAG (RAG correctivo)

Grafo `StateGraph` de LangGraph por turno, sin checkpointer (`crag-graph.ts`, diagrama en `docs/crag-graph.md`):

```text
validar ─┬─ calendario sin grupo → aclarar → fin
         ├─ cancelado o sin tiempo → error → fin
         └─ recuperar (retrieve) → reordenar en [0, 1] (rank) → valorar suficiencia (assess)
              ├─ suficiente → responder → fin
              ├─ parcial → conservar útiles → reformular → buscar
              ├─ insuficiente → descartar → reformular → buscar
              └─ límite, sin progreso o salida inválida → rechazo o error → fin
```

Perfil de calidad publicado el 18/10/2026: `MODEL_ID` y `EVALUATOR_MODEL_ID` usan `claude-sonnet-5-5`, con tarifas 2/10 USD por MTok y `CRAG_EXECUTION_BUDGET_MS=60000`. Versión `c9eae749-6cd4-4911-95a4-3cbb8390d2d9`, 100 % del tráfico, con pruebas RAG y CRAG reales y 28 operaciones de comparación dirigidas. S12 conserva su modelo y presupuesto. El saldo público leído tras las pruebas es 0,6283574 USD, menor que la reserva de otro turno CRAG (0,9000885 USD); no reiniciar ni ampliar el tope sin autorización. La evidencia está en `docs/evidence/sonnet-quality-2026-10-18.md` y la migración en `docs/sonnet-crag.md`. Desde el 26/10/2026 (versión `35d435a0-8f36-4c6b-8051-73cfae84456b`) está publicado el reparto `COURSE_QUALITY_PROFILE` (`apps/api/src/course-models.ts`): Haiku genera (`MODEL_ID`, 0,1/0,5 USD por MTok) y Sonnet evalúa y reformula en CRAG (`EVALUATOR_MODEL_ID`, 2/10). RAG reserva 0,0075295 USD por turno y CRAG sigue en 0,9000885 porque la reserva usa la tarifa mayor.

Límites por turno (`packages/rag/src/crag.ts`, `limits.ts`): 3 búsquedas, 2 reformulaciones, 10 candidatos, 6 fragmentos útiles, escala de puntuación cerrada `[0, 1]` con umbrales calibrados (`CRAG_SCORE_THRESHOLDS`: relevancia individual `>= 0,50`, cobertura parcial `>= 0,40`, cobertura suficiente `>= 0,75`) y **un único plazo de 20 s por defecto, configurable de 1 a 120 s (60 s en Sonnet)** (cada llamada recibe el tiempo restante; un resultado tardío no se acepta). `maxRetries` es 0. La ordenación validada manda el orden; `usefulIds` solo decide pertenencia; un empate conserva la posición devuelta. Los validadores rechazan ids inventados, puntuaciones fuera de `[0, 1]`, de otro grupo, corpus o perfil. Inspiración: Yan et al., _Corrective Retrieval Augmented Generation_, arXiv:2401.15884 (adaptación, no reproducción).

Puertos (`CragPorts` en `packages/rag/src/crag.ts`): `retrieve`, `rankAndAssess`, `reformulate`, `generate`, `reserve`. Implementaciones: `crag-real.ts` (Vectorize + evaluador + generador con plazo y reserva), `crag-demo.ts` (guiones S5/S6/S16 sin modelo), `local-crag-ports.ts` (índice emulado para el puente).

### Investigación (S12)

- **Fase 1, primer plano** (`research-http.ts`): el grafo corre mientras la petición sigue abierta.
- **Fase 2, durable**: `/api/research/*` (`research-routes.ts`) crea conversaciones y trabajos en `RESEARCH_DB`; cada trabajo es una instancia del Workflow `ResearchJobWorkflow` (`research-workflow.ts`, id = id del trabajo). Cada paso («tick», `research-runner.ts`) reclama un arrendamiento con ficha (`lease_token`), reanuda el grafo desde checkpoints en D1 (`research-checkpointer.ts`) y guarda el resultado.
- **Fase 3, multimodal** (`research-multimodal.ts`, `media-bytes.ts`, `research-media.ts`, `research-perception*.ts`): imagen PNG/JPEG y audio WAV PCM validados por sus bytes, guardados en R2 privado, leídos con visión o Whisper, fundidos con la pregunta como contenido no fiable (`packages/research/src/fusion.ts`) y voz opcional con Aura.

Grafo de investigación (`research-graph.ts`, nodos de evidencia en `research-gather.ts`): `validate → plan → course → tool → search → select → read → assess → decide → (follow_up → course…) → synthesize → verify → finish`. Plan de 1 a 3 subpreguntas (`packages/research/src/plan.ts`), como mucho una ronda de seguimiento con laguna concreta (`policy.ts`), solo dominios permitidos y URL https limpias (`url-policy.ts`). El informe se **verifica de forma extractiva** (`report.ts`): cada afirmación tiene que ser un tramo literal y ordenado de un extracto admitido, con las mismas cifras y negaciones; lo demás se retira. El modelo cita por índice de extracto y el servidor copia el texto (`research-excerpts.ts`). El texto de páginas y adjuntos es dato, nunca instrucción.

Dinero de la investigación (`research-money.ts`, `research-journal.ts`, triggers de `migrations-research/0001`): micro-USD enteros, tarifas congeladas por trabajo, reserva antes de cada llamada, estados `reserved → dispatched → completed | unknown` o `released`. Una llamada enviada sin resultado queda **desconocida** y nunca se reenvía; el trabajo pasa a «atención».

## Datos y almacenes

| Almacén               | Qué guarda                                                                                                | Definición                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| D1 `DB`               | `corpus_versions`, `documents`, `chunks`, `index_profiles`, `ingest_items`, `vector_map`, `public_budget` | `apps/api/migrations/0001–0004` (comentadas columna a columna)             |
| D1 `RESEARCH_DB`      | Cuenta, conversaciones, mensajes, trabajos, operaciones, eventos, checkpoints, medios                     | `apps/api/migrations-research/` y copia ejecutable en `research-schema.ts` |
| Vectorize `VECTORIZE` | Un vector por fragmento con metadatos `corpusVersion`, `audience`, `profileId`                            | Creado por la activación; perfil `p76509a5f9743`, 69 vectores              |
| R2 `CORPUS`           | Documentos y manifiestos del corpus                                                                       | `packages/rag/src/ids.ts` (claves)                                         |
| R2 `RESEARCH_MEDIA`   | Imágenes, audios y voces de la investigación                                                              | `research-media.ts`                                                        |
| Workers AI `AI`       | BGE-M3, Whisper y Aura-2                                                                                  | `vectors.ts`, `research-perception-real.ts`                                |

Versión de corpus ≠ perfil de índice: el perfil combina corpus, modelo, dimensión, métrica y troceado. Cambiar el modelo de embeddings exige perfil, índice e ingesta nuevos; nunca se mezclan familias (`fixture` y `workers-ai`).

## Activación, ingesta y verificación (scripts)

`bun run activate <comando>` (`scripts/activate.ts`): `plan`, `status --read`, `provision`, `migrate`, `probe-embeddings`, `ingest`, `resume`, `select-active`, `verify`. Las reglas de permisos están en `scripts/activation.ts`; el ejecutor de Wrangler en `scripts/course-executor.ts`; las operaciones de datos (sonda, ingesta con caché de vectores, selección) en `scripts/course-runtime.ts`. Los comandos de datos arrancan un **Worker puente** propio en `127.0.0.1` (`scripts/loopback-bridge.ts`, `scripts/runtime-plane.ts`, `apps/api/src/bridge-worker.ts`) con una ficha compartida que viaja por `.dev.vars`, nunca por argumentos.

La ingesta (`packages/rag/src/ingest.ts`, adaptada en `apps/api/src/ingest-run.ts`) escribe R2 → D1 → Vectorize y **lee de vuelta** cada paso; el diario `ingest_items` permite reanudar. Un lote aceptado pero aún invisible queda `pending-visibility` y no se reenvía. La métrica que permite `ready` es la de `wrangler vectorize get`, no la de `describe()`. Cada llamada de pago se reserva en una sesión de gasto persistente (`packages/rag/src/allowance.ts`, `scripts/execution-session.ts`) que nunca trata un precio desconocido como cero.

`scripts/configure-production.ts` es el generador histórico de `wrangler.jsonc`: reescribe el archivo sin comentarios ni el entorno `research`. No usarlo sin revisar el diff.

## Proveedores de modelos

`apps/api/src/model.ts:createLanguageModel` es la única fábrica. `LLM_PROVIDER`: `anthropic` (por defecto, `effort: low`), `openai`, `openrouter` (lee una vez el catálogo público para elegir el razonamiento mínimo), `gemini` o `compatible`. Cada papel tiene su variable: `MODEL_ID`, `EVALUATOR_MODEL_ID`, `RESEARCH_MODEL_ID`, `RESEARCH_VISION_MODEL_ID`. Las tarifas `*_USD_PER_MILLION` sirven para el coste mostrado y para reservar (`provider-cost.ts`). Embeddings, Whisper y Aura siguen en Workers AI. Detalle de uso en `README.md#elegir-proveedor-y-modelo`.

## Interfaz web (`apps/web/src`)

`App.tsx` monta los selectores de etapa y grupo, el chat (`useChat` del AI SDK) y el panel lateral de fuentes, traza y grafo CRAG. El **modo clase** (interruptor de la barra o `?clase`) dibuja encima del chat el grafo de RAG básico o de CRAG. Resalta el nodo por el que pasa el turno con los pasos que llegan por el stream (`data-rag-step` de `rag-steps.ts`; `data-step` de CRAG con candidatos, nota del juez y lagunas) y permite repetirlo paso a paso sin llamar a ningún modelo (`class-mode.ts`, lógica pura; `class-mode-view.tsx`, vista). El interruptor **Modo lento** de la cabecera del grafo (o `?lento`) enseña los pasos de uno en uno cada 3,5 s aunque lleguen antes. Una línea de pasos permite saltar a cualquiera, la arista de llegada al nodo activo destaca en azul y el inspector explica en una frase qué hace cada nodo. La búsqueda de RAG ocurre antes de abrir el stream para conservar los 409 y 502: sus pasos llegan juntos con la duración medida en el servidor, y la generación sí se emite en directo. Cambiar de etapa, de grupo o reiniciar crea una conversación aislada (`scope.ts`). La investigación durable usa la mesa `research-desk.tsx` (sondeo del trabajo, adjuntos, presupuesto) y `research-panel.tsx` (fuentes y traza). Las respuestas se pintan con un Markdown reducido propio (`course-markdown.ts` → `course-answer.tsx`) que nunca inserta HTML del modelo. El movimiento sale del catálogo de transitions.dev (`transitions.css`, `chat-motion*.ts(x)`) y respeta `prefers-reduced-motion`. Turnstile vive en `use-turnstile.tsx`, `verification-cycle.ts` y `turnstile-widget.ts`. La verificación se ejecuta bajo demanda antes de cada mutación; no se precargan tokens ni se reinicia el desafío al terminar la respuesta.

## Archivos uno a uno

### `apps/api/src`

| Archivo                                                                                   | Qué hace                                                                              |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `worker.ts`                                                                               | Entrada del Worker publicado: `/api/security` y la app Hono.                          |
| `research-worker.ts`                                                                      | Entrada con investigación durable: además exporta la clase del Workflow.              |
| `local-worker.ts`                                                                         | Entrada de `dev:real`: solo localhost, mismo origen y presupuesto `LOCAL_BUDGET_USD`. |
| `app.ts`                                                                                  | Rutas `/api/health` y `/api/chat` con las cuatro etapas.                              |
| `env.ts`                                                                                  | Lee variables y bindings y diagnostica cada capacidad sin red.                        |
| `model.ts`                                                                                | Fábrica única de modelos por proveedor y razonamiento por defecto.                    |
| `prompts.ts`                                                                              | Instrucciones versionadas de cada etapa y bloque DATOS/PERMITIDOS.                    |
| `course-stream.ts`                                                                        | Convierte respuestas en el stream de UI del AI SDK y valida citas.                    |
| `rag-steps.ts`                                                                            | Pasos del RAG básico para el modo clase (búsqueda medida, umbral, generación, citas). |
| `demo-stream.ts`                                                                          | Stream fijo de la demo sin RAG.                                                       |
| `course-context.ts`                                                                       | RAG con contexto completo validado contra el manifiesto.                              |
| `stores.ts`, `vectors.ts`                                                                 | Adaptadores mínimos de Vectorize/D1/R2 y embeddings BGE-M3 con plazo.                 |
| `fixture.ts`, `fixture-bytes.ts`                                                          | Corpus de la demo con vectores léxicos y lectura de archivos de prueba.               |
| `public-budget.ts`                                                                        | Reserva condicional del presupuesto público por turno.                                |
| `provider-cost.ts`                                                                        | Coste estimado con tarifas configuradas (nunca es factura).                           |
| `chat-protection.ts`                                                                      | Sesión anónima firmada, cupos y Turnstile.                                            |
| `compat.ts`                                                                               | Comprobación de que LangGraph y el SDK cargan (para `/api/health`).                   |
| `crag-http.ts`                                                                            | Etapa CRAG por HTTP: puertos, grafo y stream.                                         |
| `crag-graph.ts`                                                                           | Grafo LangGraph de CRAG con límites y traza.                                          |
| `crag-real.ts`                                                                            | Puertos reales de CRAG con plazo y reserva.                                           |
| `crag-demo.ts`                                                                            | Puertos de guion de la demo de CRAG.                                                  |
| `local-crag-ports.ts`, `local-emulated-model.ts`, `local-vectorize.ts`, `local-schema.ts` | Emuladores para la verificación local sin proveedores.                                |
| `bridge-worker.ts`                                                                        | Worker puente de los scripts (loopback y ficha).                                      |
| `ingest-run.ts`, `memory-bindings.ts`                                                     | Ingesta con bindings reales y dobles en memoria para probarla.                        |
| `verify-session.ts`                                                                       | Verificación local de las etapas con dobles.                                          |
| `research-http.ts`                                                                        | Investigación en primer plano (fase 1).                                               |
| `research-routes.ts`                                                                      | API durable `/api/research/*` con propietario, origen, Turnstile y cupos.             |
| `research-owner.ts`                                                                       | Identidad del propietario (sesión de Turnstile o cookie local firmada).               |
| `research-store.ts`, `research-db.ts`, `research-sqlite.ts`, `research-schema.ts`         | Almacén SQL durable, interfaz común D1/SQLite y esquema.                              |
| `research-workflow.ts`, `research-dispatch.ts`, `research-runner.ts`                      | Workflow, lanzamiento sin duplicar y paso durable con arrendamiento.                  |
| `research-checkpointer.ts`                                                                | Checkpointer de LangGraph sobre D1.                                                   |
| `research-journal.ts`, `research-money.ts`                                                | Diario de operaciones de pago y dinero en micro-USD.                                  |
| `research-graph.ts`, `research-gather.ts`, `research-state.ts`                            | Grafo de investigación, nodos de evidencia y estado compartido.                       |
| `research-real.ts`, `research-live.ts`, `research-tool.ts`                                | Adaptadores reales, construcción condicionada y herramienta `get_course_session`.     |
| `firecrawl.ts`, `tavily.ts`                                                               | Clientes de búsqueda y lectura con bytes acotados y sin redirecciones.                |
| `research-fixture.ts`, `research-fixture-data.ts`                                         | Guiones y páginas sintéticas de la demo.                                              |
| `research-prompts.ts`, `research-excerpts.ts`, `research-memory.ts`                       | Instrucciones, extractos citables por índice y memoria de conversación.               |
| `research-summary.ts`, `research-result.ts`                                               | Resumen público y resultado guardado (informes largos aparte).                        |
| `research-multimodal.ts`, `research-media.ts`, `media-bytes.ts`, `media-byte-samples.ts`  | Entrada/salida multimodal, R2 de medios y validación de bytes.                        |
| `research-perception.ts`, `research-perception-real.ts`                                   | Visión, Whisper y Aura (demo y real).                                                 |
| `snapshot-hash.ts`, `context-evaluation-model.ts`                                         | Hash de páginas y reexportación para scripts de evaluación.                           |

### `packages`

| Archivo                                                              | Qué hace                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `contracts/src/chat.ts`, `ui-message.ts`                             | Petición de chat y tipo del mensaje del stream.                     |
| `contracts/src/domain.ts`, `errors.ts`, `health.ts`                  | Tipos de dominio, errores y respuesta de salud.                     |
| `contracts/src/limits.ts`, `media.ts`                                | Límites globales, variables, proveedores y límites multimodales.    |
| `contracts/src/crag.ts`, `research.ts`                               | Contratos de CRAG e investigación (guiones, pasos, resúmenes).      |
| `rag/src/chunk.ts`, `prepare.ts`, `ids.ts`, `hash.ts`                | Troceado, preparación del corpus, ids e huellas.                    |
| `rag/src/pipeline.ts`, `calendar.ts`                                 | Recuperación básica, umbral, filtro de citas y atajo de calendario. |
| `rag/src/crag.ts`, `limits.ts`                                       | Reglas puras de CRAG y topes.                                       |
| `rag/src/ingest.ts`, `embedding-cache.ts`, `provenance.ts`, `sql.ts` | Ingesta idempotente, caché de vectores, procedencia y SQL seguro.   |
| `rag/src/allowance.ts`                                               | Sesión de gasto que reserva el peor caso.                           |
| `rag/src/fixture-embed.ts`, `local-emulated-embed.ts`                | Embeddings léxicos de demo y de emulación local.                    |
| `rag/src/ports.ts`, `types.ts`                                       | Interfaces de puertos y tipos básicos.                              |
| `research/src/plan.ts`, `policy.ts`                                  | Validación del plan y política de rondas y paradas.                 |
| `research/src/evidence.ts`, `report.ts`, `speech-script.ts`          | Evidencia y cobertura, verificación extractiva y guion de voz.      |
| `research/src/fusion.ts`, `url-policy.ts`, `ports.ts`                | Fusión multimodal, política de URLs y puertos.                      |

### `apps/web/src`

`main.tsx` (arranque), `App.tsx` (interfaz), `chat.ts` (tipo y transporte), `scope.ts` (clave de conversación), `crag-panel.ts` (claves del panel CRAG), `course-markdown.ts` + `course-answer.tsx` (Markdown seguro), `chat-motion.ts` + `chat-motion-view.tsx` + `transitions.css` (movimiento), `class-mode.ts` + `class-mode-view.tsx` (modo clase), `research-desk.tsx`, `research-panel.tsx`, `research-submit.ts`, `research-labels.ts` (investigación), `use-turnstile.tsx` + `verification-cycle.ts` + `turnstile-widget.ts` (Turnstile bajo demanda), `styles.css` (estilos propios).

### `scripts`

| Script                                                                                                               | Qué hace                                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `prepare-corpus.ts`, `source-bodies.ts`                                                                              | Prepara `corpus/prepared/corpus.json` y `COVERAGE.md`.                                       |
| `preflight.ts`, `local-worker-config.ts`, `wrangler-parse.ts`                                                        | Diagnóstico sin red de la configuración que vería el Worker.                                 |
| `activate.ts`, `activation.ts`, `course-executor.ts`, `course-runtime.ts`, `course-destination.ts`                   | CLI de activación, permisos, ejecutor de Wrangler y operaciones de datos.                    |
| `loopback-bridge.ts`, `runtime-plane.ts`, `bridge-client.ts`, `loopback-fetch.ts`, `process-runner.ts`               | Puente local y su cliente.                                                                   |
| `execution-session.ts`                                                                                               | Sesión de gasto persistente y atómica.                                                       |
| `http-verify.ts`                                                                                                     | Verificación por HTTP de cinco turnos contra el puente.                                      |
| `ingest-plan.ts`, `reconcile-startup-budget.ts`, `anthropic-key.ts`                                                  | Plan de ingesta, comando retirado y lectura de claves locales.                               |
| `calibrate-live.ts`, `compare-live.ts`, `evaluate-*.ts`, `verify-chat-protection-live.ts`, `configure-production.ts` | Operaciones reales con gasto o lectura remota: solo con `--execute`/`--read` y autorización. |
| `*.test.ts`, `*.integration.ts`, `*.workerd.ts`                                                                      | Pruebas unitarias y de entrada contra workerd.                                               |

## Runtime

- Aula / Inspector (`bun run lab:aula`) es un servidor Bun local en `127.0.0.1:5192`, independiente del Worker. `lab/ui` contiene su React; `lab/aula` adapta el pipeline real mediante observadores y guarda recorridos/eventos en PostgreSQL. `scripts/lab-aula.ts` compila la interfaz al arrancar. No sirve archivos de entorno ni entrega claves al navegador. Para consumir APIs exige `--execute --max-spend-usd` con el límite acumulado del laboratorio; comparte presupuesto y bloqueo con `lab:real`.
- El Aula pausa antes de cada operación y fuera de transacciones. GET/SSE solo observan, recargar no repite llamadas, cada avance identifica la etapa pendiente y el diario confirma cada evento antes de publicarlo. Las tablas `lab_aula_runs`/`lab_aula_events` se conservan al reconstruir el corpus. La comparación «Sin documentos» mantiene las mismas instrucciones del generador con contexto vacío. Guion y SQL de clase: `material/aula/`; ensayo: `docs/evidence/aula-inspector-2026-10-23.md`. No confundir este pgvector de 768 dimensiones con producción D1/Vectorize.

- Bun 1.4.2 instala dependencias y ejecuta `scripts/`.
- Vite+ 1.0.0 ejecuta desarrollo, formato, lint, tipos y pruebas con Node.
- El Worker corre en workerd. `apps/api` no usa APIs exclusivas de Bun ni el disco como almacén.
- Sin `--env`, la configuración local sale de `apps/web/wrangler.jsonc` y, si existe, `apps/web/.dev.vars`. Con `--env`, las `vars` y los bindings no se heredan del nivel superior. Si existe `.dev.vars.<entorno>`, solo se carga ese archivo. No se mezcla `process.env`.
- `demo` no necesita secretos. `real` para sin RAG necesita la clave del proveedor de `LLM_PROVIDER` y `MODEL_ID`. Sin `LLM_PROVIDER` es `anthropic` con `ANTHROPIC_API_KEY` (`apps/web/wrangler.jsonc` fija `claude-haiku-5-5` como generador y `claude-sonnet-5-5` como evaluador); también admite `openai`, `openrouter` (cualquier modelo de su catálogo), `gemini` y `compatible`. Un mismo proveedor sirve a todos los papeles generativos: chat, RAG, evaluador de CRAG, investigación y visión. `apps/api/src/model.ts:createLanguageModel` es la única fábrica y `README.md#elegir-proveedor-y-modelo` explica el uso. Producción usa siempre `anthropic` (`LLM_PROVIDER` fijado en `env.production`): no cambiar de proveedor allí salvo petición expresa del usuario. RAG real necesita además embeddings, dimensión observada, versión, perfil, métrica `cosine`, umbral y los bindings `AI`, `VECTORIZE`, `DB` y `CORPUS` configurados. El perfil tiene que estar `ready` y coincidir. `EVALUATOR_MODEL_ID` no bloquea esas dos etapas. CRAG real lo añade y, si falta, no vuelve a RAG básico. Embeddings siguen en Workers AI.
- Entornos de `apps/web/wrangler.jsonc`: nivel superior (demo), `production` (la URL pública), `local` (`bun run dev:real`, bindings reales del curso y presupuesto propio) y `research` (`bun run dev:research`, D1/R2/Workflow locales).

## Versiones

Las dependencias directas van fijadas. `vite` se resuelve a `@voidzero-dev/vite-plus-core@1.0.0` y `vitest` queda en `5.0.1`. `dotenv` 16.3.1 iguala el parser de Wrangler. No añadir ESLint, Prettier, Turborepo, Nx, TanStack AI, PostgreSQL ni un segundo Vitest. Principales: Hono 4.13.12, AI SDK 7.0.127 (`@ai-sdk/react` 4.0.130), LangGraph.js 1.4.18, Zod 4.6.5, React 19.3.0, Wrangler 4.147.0, TypeScript 7.0.2.

## Comandos

Desde este directorio:

```sh
bun install --frozen-lockfile
bun run prepare-corpus
bun run dev
bun run dev:research
bun run check
bun run test
bun run build
bun run preflight
bun run preflight:research
bun run preflight -- --capability rag
bun run ingest-plan
bun run activate
bun run activate -- status --read
bun run test:entrypoint
bun run lab:rebuild
bun run lab:demo
bun run lab:eval
```

`bun run preview` sirve el build en local y tampoco despliega. `bun run dev:research` abre la investigación durable en `http://127.0.0.1:5191/` con D1, Workflows y el R2 local de medios en `apps/web/.wrangler/research-state`. No usa el D1 remoto del curso. La evidencia de las fases anteriores se conserva. La de la fase 7 está en `docs/phase-7-verification.md`. La de la investigación durable está en `docs/s12-research-phase2.md` y la multimodal en `docs/s12-research-phase3.md`. El plan de recursos está en `docs/cloud-activation-plan.md`.

`scripts/activate.ts` arranca el puente solo para `probe-embeddings`, `ingest`, `resume`, `select-active` y `verify` con `--execute` y la autorización de esa operación. `plan` y `status --read` no lo arrancan. Sin autorización, `--execute` sale con código 2 y no abre el puerto. `resume()` sin plano sigue siendo la lectura administrativa. `select-active` exige la lectura final en D1 y no borra perfiles anteriores. Un listado Vectorize o de metadatos que no traiga el sobre esperado es lectura no confirmada y no crea nada. `bun run test:entrypoint` recorre el CLI contra workerd en `127.0.0.1` con recursos emulados y sin red externa.

## Pruebas y verificación

- `bun run check`: formato, lint con tipos y comprobación de TypeScript de todo el monorepo (`vite.config.ts`).
- `bun run test`: pruebas unitarias (`apps/**`, `packages/**`, `scripts/**/*.test.ts`) sin red; los proveedores se sustituyen por dobles (`MockLanguageModel`, bindings en memoria, SQLite de `node:sqlite`).
- `bun run test:entrypoint`: tres pruebas de entrada contra workerd real (CLI de activación, investigación de demo y investigación durable con Workflow).
- Un cambio de código exige `check` y `test` en verde. Un cambio en la activación, el puente o la investigación durable exige además `test:entrypoint`.
- Aula añade ocho pruebas de controles/HTTP/SSE en `scripts/lab-aula.test.ts`. `bun scripts/verify-aula-persistence.ts` comprueba el roundtrip JSONB con PostgreSQL local real dentro de una transacción revertida, sin proveedores y sin dejar un ensayo sintético en el historial. El SQL de TablePlus debe validarse con el UUID de una ejecución real.
- Las evaluaciones con gasto (`compare-live`, `calibrate-live`, `evaluate-*`) usan conjuntos de desarrollo o reservados. No reutilizar el conjunto reservado para ajustar y volver a anunciar su resultado como independiente.

## Decisiones que no se cambian sin motivo

- **Honestidad de los datos**: uso y coste desconocidos viajan como `null`, nunca como cero. Un USD calculado con tarifas no se presenta como importe del proveedor. Una reserva es un tope, no un gasto.
- **Sin sustituciones silenciosas**: un modo real incompleto responde 409; no cae a la demo, a otra etapa ni a otro proveedor. No hay reintentos automáticos de llamadas de pago.
- **Rechazar sin gastar**: aclarar y rechazar no llaman al modelo. Lo que no consta se dice («no consta»), no se inventa.
- **Contenido externo = dato**: fragmentos, páginas, transcripciones y lecturas de imagen van en bloques DATOS marcados como no fiables. Las instrucciones incrustadas se marcan y se ignoran.
- **Citas verificables**: solo ids reales de la evidencia permitida. En investigación, solo tramos literales.
- **Un plazo por turno**: CRAG usa el plazo validado de su perfil (20 s por defecto, 60 s Sonnet); la investigación tiene su plazo de trabajo y plazos por llamada dentro de él.
- **Presupuestos separados**: chat público (`public_budget`, 4,30 USD), local (`LOCAL_BUDGET_USD`) e investigación (cuenta `research`).
- **Lectura de vuelta**: ningún almacén se declara listo por un booleano del llamador; se comprueba leyendo.
- Decisiones con fecha y contexto en `docs/decisions.md`.

## Convenciones de código y comentarios

- Todo comentario va en **español**. Cada archivo empieza con `// GUÍA DE LECTURA · <ruta>` (o el equivalente en CSS, SQL o HTML) que explica qué hace el archivo y por qué existe.
- Comentario encima de cada declaración y de cada paso no trivial; en objetos y listas largas, un comentario por grupo de campos. Explicar qué, por qué y cómo, no repetir el código.
- TypeScript estricto (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`), sin `console.log` fuera de `scripts/`, comillas dobles y punto y coma (`vp fmt`).
- JSX: comentarios con `{/* … */}` entre elementos; nunca partir una línea de texto JSX con un comentario (cambia los espacios renderizados). Dentro de una expresión `{…}` se usa `//`.
- SQL de migraciones: solo comentarios `--` de **línea completa** y sin `;` en el texto del comentario. `schemaStatements` (`research-db.ts`) y `scripts/local-schema.test.ts` saltan esas líneas. `apps/api/src/research-schema.ts` debe seguir igual que `migrations-research/` (sin acentos graves en los comentarios porque es un literal de plantilla). `local-schema.ts` repite literalmente las sentencias de `migrations/0001–0003`.
- `apps/web/wrangler.jsonc`: solo comentarios `//` de línea completa (los scripts los quitan con una expresión regular; un bloque `/* */` rompería `"/api/*"`).
- No cambiar SQL dentro de cadenas de TypeScript para comentar: `memory-bindings.ts` reconoce las consultas de `ingest-run.ts` por su texto.
- Movimiento de interfaz: usar los tokens y clases de `transitions.css`; no inventar duraciones ni curvas.

## Cómo responder a un alumno

1. Localiza la pieza con la tabla de archivos o con `rg`; lee su `GUÍA DE LECTURA` y los comentarios.
2. Explica el flujo con rutas concretas (`archivo:línea`) y el porqué que aparece en este documento o en `docs/decisions.md`.
3. Si pregunta por resultados o calidad, cita la evidencia (`docs/despliegue-real.md`, `docs/rag-contexto-completo.md`, `material/comparacion/`) y sus límites: son conjuntos pequeños, no tasas generales.
4. Para probar algo, propone comandos sin gasto (`bun run dev`, `bun run dev:research`, `bun run test`). No ejecutes comandos con `--execute`, `dev:real` ni despliegues.
5. Si algo no está en el código ni en los documentos, dilo; no lo inventes.

## Documentación

| Documento                                                                   | Contenido                                                  |
| --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `README.md`                                                                 | Uso, recorrido de la demo, proveedores y estado publicado. |
| `docs/architecture.md`                                                      | Arquitectura y límites de código.                          |
| `docs/decisions.md`                                                         | Decisiones con fecha y motivo.                             |
| `docs/crag-graph.md`, `docs/crag-demo-walkthrough.md`                       | Grafo CRAG y recorrido de la demo.                         |
| `docs/rag-contexto-completo.md`                                             | Por qué el RAG publicado usa el contexto completo.         |
| `docs/despliegue-real.md`, `docs/desarrollo-local-real.md`                  | Producción y perfil local real.                            |
| `docs/cloud-activation-plan.md`                                             | Plan de recursos y comandos de activación.                 |
| `docs/s12-research-phase1.md` … `phase3.md`, `docs/s12-cloud-deployment.md` | Investigación S12 y su despliegue.                         |
| `docs/phase-1-verification.md` … `phase-7-verification.md`                  | Evidencia de cada fase.                                    |
| `docs/evidence/`, `docs/review/`                                            | Recibos, capturas y revisiones.                            |
| `corpus/README.md`, `corpus/COVERAGE.md`                                    | Fuentes del corpus y cobertura.                            |
| `material/README.md`                                                        | Paquete docente de S10 y S11.                              |

## Memoria

La memoria de OpenViking sigue pendiente: el selector `~/.config/openviking/workspace-account.sh` no devuelve una cuenta para este repositorio. No inventar una cuenta ni escribir en otro tenant (`docs/decisions.md#openviking`).
