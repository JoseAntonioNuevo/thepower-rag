# Estado publicado · 18 de octubre de 2026

**S10 lista para seguir en directo:** [guion 30+50+10](material/guiones/S10-guion-profesor.md), [presentación](material/presentaciones/S10-rag-basico.pptx), [laboratorio real](lab/README.md) y [ensayo verificado](material/S10/evidencias/evaluacion-real-resumen.md). El respaldo offline está identificado y sus cifras no se atribuyen a modelos reales.

**Aula / Inspector local (23/10):** [guion de 60 minutos y TablePlus](material/aula/guion-aula.md). `bun run lab:aula --execute --max-spend-usd 1` abre el laboratorio en `http://127.0.0.1:5192/`, con pausas antes de operar, datos reales de pgvector/proveedores y ejecuciones guardadas. [Preparación](lab/README.md#aula--inspector--ejecución-visual-con-datos-reales) · [evidencia](docs/evidence/aula-inspector-2026-10-23.md).

Aplicación real: https://rag-thepower.josenuevo.dev. Sin RAG, RAG básico y CRAG usan los servicios remotos. [Operación y límites verificados](docs/despliegue-real.md). [Comparación histórica de 40 respuestas](material/comparacion/resultados/tabla-resultados.md). El arranque local sigue siendo una demo offline.

S12 también está publicado: conversaciones aisladas, investigación asíncrona, contabilidad durable e imagen, audio y voz opcional. Desde el 26/10/2026 investiga sobre la tienda ficticia ThePower Shop: sus políticas, la herramienta de solo lectura `get_order` sobre pedidos ficticios y la normativa de consumo de la UE y del BOE ([decisión](docs/decisions.md)). Su configuración y la evidencia de publicación están en [despliegue de S12](docs/s12-cloud-deployment.md).

## Perfil de calidad publicado · 18 de octubre de 2026

**Sonnet 5.5** está publicado para el generador de sin RAG/RAG/CRAG y su evaluador, con 30 s por llamada y un plazo único de CRAG de **60 segundos**. La versión `c9eae749-6cd4-4911-95a4-3cbb8390d2d9` recibe el 100 % del tráfico; se verificaron health, una respuesta RAG y otra CRAG con fuentes. La comparativa dirigida completó 28 llamadas; el conjunto reservado de veinte preguntas sigue sin ejecutar con Sonnet. La [evidencia de publicación y pruebas](docs/evidence/sonnet-quality-2026-10-18.md) separa estos resultados de los históricos. S12 mantiene Haiku, Whisper y Aura. El 26/10 se publicó el reparto Haiku generador y Sonnet evaluador, versión `35d435a0-8f36-4c6b-8051-73cfae84456b` ([decisión](docs/decisions.md)).

Tras las dos pruebas quedan **0,6283574 USD** para nuevas reservas públicas. Un turno CRAG Sonnet requiere reservar **0,9000885 USD** y quedará bloqueado por el tope acumulado existente. No se ha reiniciado ni ampliado ese presupuesto. El [informe de migración](docs/sonnet-crag.md) explica costes y límites.

# Asistente RAG del AI Engineer

Proyecto de clase para The Power. El producto será un asistente en español del programa completo de AI Engineer, de la sesión 1 a la 20. Cada respuesta con recuperación debe citar sus documentos y reconocer lo que no consta.

El temario de S1 a S20 y los dos calendarios de AI Engineer están en el corpus. El detalle de varios ejercicios sigue siendo solo un título. La cobertura generada está en `corpus/COVERAGE.md`. El despliegue real del RAG usa el perfil Vectorize `p76509a5f9743`, con 69 vectores leídos de vuelta; su estado está en [despliegue real](docs/despliegue-real.md).

## Clases 10, 11 y 12, cuatro etapas

S10, el 22 de octubre de 2026, cubre las dos primeras etapas. S11, el 27 de octubre de 2026, evoluciona la misma aplicación. S12 añade investigación y entradas multimodales sobre el mismo grafo.

1. **Sin RAG.** Conversación sin documentos. En demo es un stream sin modelo. En real llama a la API de Claude.
2. **RAG básico.** La configuración de referencia de S10 (`RAG_CONTEXT_MODE=semantic`) embebe la consulta, busca en Vectorize con filtro de grupo, aplica el umbral calibrado (`0,50`) antes de llamar al modelo y responde con citas o rechaza sin generar. La variante `RAG_CONTEXT_MODE=complete` lee de D1 todos los fragmentos autorizados del curso cuando se quiere mostrar contexto completo sobre un corpus pequeño.
3. **CRAG.** Un grafo correctivo con nodos separados de reordenamiento (`rank`, escala `[0, 1]`) y valoración de suficiencia (`assess`, umbrales `CRAG_SCORE_THRESHOLDS`), tres búsquedas y dos reformulaciones como máximo, un solo plazo por turno (20 s por defecto; 60 s en el perfil Sonnet) y la ordenación validada. En demo usa guiones. En real, si falta configuración o una sesión de gasto, no llama al proveedor y no usa otra etapa.
4. **Investigación.** Sobre ThePower Shop: plan acotado que separa la política de la tienda, los datos de un pedido (`get_order`) y la normativa externa (`europa.eu`, `eur-lex.europa.eu` y `www.boe.es`), conversaciones aisladas, Workflow asíncrono y un presupuesto propio. Admite imagen PNG/JPEG, audio WAV corto y voz opcional. El caso de clase es la foto del pedido `TPS-20481` y una nota de voz (`apps/api/fixtures/media/`). La demostración local usa guiones; producción usa Tavily y los adaptadores reales configurados.

## Arquitectura

El navegador habla con un único Worker. Workers Static Assets sirve React. Hono atiende `/api/*`.

- Vectorize guarda y consulta el índice real BGE-M3 del curso; el perfil y los 69 vectores están verificados en el informe de despliegue.
- D1 guarda texto, metadatos, versiones y registros de ejecución.
- R2 guarda el corpus privado y, en S12, adjuntos de investigación en un bucket aparte.
- Workers AI ejecuta embeddings con `@cf/baai/bge-m3`; la dimensión observada en esta cuenta es 1024.
- Desde el 26/10 (versión `35d435a0-8f36-4c6b-8051-73cfae84456b`) producción genera con `claude-haiku-5-5` (Sin RAG, RAG y respuesta final de CRAG) y evalúa y reformula CRAG con `claude-sonnet-5-5`. Del 18 al 26/10 Sonnet hizo los dos papeles; antes generaba Haiku. El código admite cualquier otro proveedor y modelo: [elegir proveedor y modelo](#elegir-proveedor-y-modelo).

El perfil demo no usa esos servicios. Usa un índice lexical de 128 dimensiones, etiquetado como prueba. No es una búsqueda semántica ni Vectorize.

Para los ejercicios publicados de S10 y S11, el directorio [`lab/`](lab/README.md) acompaña al demostrador con un **laboratorio reproducible sobre PostgreSQL + `pgvector` (`vector(768)` e índice HNSW)**, 10 documentos ficticios de AetherCloud, reconstrucción desde índice vacío (`bun run lab:rebuild`), recorrido de S10 y S11 (`bun run lab:demo`) y evaluación ejecutada de 20 preguntas (`bun run lab:eval`, [`lab/eval/resultados-laboratorio.md`](lab/eval/resultados-laboratorio.md)).

## Requisitos

- Bun 1.4.2.
- Node.js para el tooling de Vite+. El preflight imprime la versión que haya en la máquina.
- Para la demostración no hace falta cuenta ni clave.

Bun instala y lanza los scripts. Vite+ usa Node. El Worker publicado corre en el runtime de Cloudflare.

## Arranque de la demostración

```sh
bun install --frozen-lockfile
bun run dev
```

La aplicación queda en `http://localhost:5173/`. El perfil de `apps/web/wrangler.jsonc` es `demo`.

Recorrido local:

1. Sin RAG: escribe una pregunta y observa el stream etiquetado. No hay fuentes.
2. Cambia a RAG básico. La conversación anterior se vacía. Pregunta cómo modela LangGraph un agente con estado y nodos. La respuesta cita la ficha y muestra la traza.
3. Pregunta qué beca interna de 1991 cubre el programa. No consta y no llama a un modelo.
4. En audiencia General, pregunta cuándo es la clase. Pide elegir L/X o M/J. En M/J, la pregunta por la clase de RAG S10 debe mostrar 2026-10-22 y no el calendario L/X.
5. En CRAG elige un guion o escribe su pregunta. El selector no cambia de guion mientras la respuesta está en curso. El recorrido suficiente cita S5. El parcial cita S5 y S6. El rechazo de la beca de 1991 repite el descarte sin claves duplicadas y no llama a un modelo. El detalle está en `docs/crag-demo-walkthrough.md`.

## Comprobaciones

```sh
bun run prepare-corpus
bun run check
bun run test
bun run build
bun run preflight
bun run ingest-plan
bun run activate
bun run test:entrypoint
bun run preflight -- --capability rag
```

`bun run preview` sirve el build sin publicarlo.

## Variables y bindings

| Nombre                 | Uso                                          |
| ---------------------- | -------------------------------------------- |
| `APP_MODE`             | `demo` o `real`                              |
| `LLM_PROVIDER`         | Proveedor de los modelos; vacío, `anthropic` |
| Clave del proveedor    | `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`…   |
| `MODEL_ID`             | Modelo generativo del servidor               |
| `EMBEDDING_MODEL`      | Modelo de embeddings del RAG real            |
| `EMBEDDING_DIMENSIONS` | Dimensión observada, no supuesta             |
| `CORPUS_VERSION`       | Versión de preparación que se consulta       |
| `INDEX_PROFILE`        | Perfil de índice, distinto del hash lexical  |
| `VECTOR_METRIC`        | Debe ser `cosine` en el perfil real          |
| `MIN_RETRIEVAL_SCORE`  | Umbral calibrado del índice que se use       |
| `EVALUATOR_MODEL_ID`   | Solo CRAG real. No bloquea las otras etapas  |
| `LLM_REASONING_EFFORT` | Opcional. Razonamiento de todos los modelos  |

La generación configurada no implica que el RAG esté listo. El umbral 0,33 pertenece solo al coseno lexical de la demostración. El 0,55 del emulador local tampoco es un umbral de BGE-M3. El plan de recursos y los comandos están en `docs/cloud-activation-plan.md`. La evidencia de la fase 7 está en `docs/phase-7-verification.md`. Las fases anteriores siguen en sus documentos.

Los secretos van en `apps/web/.dev.vars`. Ese archivo y cualquier `.dev.vars*` quedan fuera de Git, salvo `.dev.vars.example`. No uses `VITE_*` para secretos.

En local, `.dev.vars` sustituye las claves repetidas de `vars`. El entorno del proceso no entra en el Worker. `bun run preflight` muestra nombres y perfiles, no valores, y no abre conexiones. Si `APP_MODE=real` y falta la generación, el código de salida es 2.

El perfil demo no declara los recursos de la cuenta. Producción usa los bindings del curso y los bindings durables propios de S12 descritos en `docs/s12-cloud-deployment.md`.

Cuando el perfil real tenga la clave del proveedor y `MODEL_ID`, sin RAG llamará a ese modelo. RAG real llamará además a Workers AI, Vectorize y D1.

## Elegir proveedor y modelo

El código no está atado a Claude. `LLM_PROVIDER` elige el proveedor de todos los modelos generativos: sin RAG, RAG básico, evaluador y reformulador de CRAG, planificador de la investigación y visión. Cada papel tiene su variable de modelo: `MODEL_ID`, `EVALUATOR_MODEL_ID`, `RESEARCH_MODEL_ID` y, opcional, `RESEARCH_VISION_MODEL_ID`. Los IDs van en el formato de ese proveedor. Sin `LLM_PROVIDER` se usa `anthropic`, la ruta publicada.

| Para usar…                                                                                       | `LLM_PROVIDER` | Clave                                                      | Ejemplo de `MODEL_ID`                     |
| ------------------------------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------- | ----------------------------------------- |
| Claude por la API de Anthropic (ruta publicada)                                                  | `anthropic`    | `ANTHROPIC_API_KEY` (y `ANTHROPIC_WORKSPACE_ID`, opcional) | `claude-haiku-5-5`                        |
| GPT por la API de OpenAI                                                                         | `openai`       | `OPENAI_API_KEY`                                           | `gpt-6-luna`                              |
| **Cualquier modelo de OpenRouter**: Claude, GPT, Gemini, GLM, Kimi, DeepSeek, Qwen, Llama, Grok… | `openrouter`   | `OPENROUTER_API_KEY`                                       | `z-ai/glm-5.3` (ID exacto de su catálogo) |
| Gemini con clave de Google AI Studio                                                             | `gemini`       | `GEMINI_API_KEY`                                           | `gemini-3.1-flash-lite`                   |
| Groq, Mistral, DeepSeek, Ollama, vLLM u otra API compatible con Chat Completions                 | `compatible`   | `COMPAT_BASE_URL` y, si la pide, `COMPAT_API_KEY`          | El ID de ese servidor                     |

Ejemplo con OpenRouter y un modelo distinto para cada papel:

```sh
APP_MODE=real
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=tu-clave
MODEL_ID=moonshotai/kimi-k3
EVALUATOR_MODEL_ID=google/gemini-3.1-flash-lite
RESEARCH_MODEL_ID=z-ai/glm-5.3
```

Para cambiar de proveedor:

1. Pon `LLM_PROVIDER`, su clave y los modelos en `apps/web/.dev.vars`. En local, `bun run dev` también toma `LLM_PROVIDER` y las claves del `.env` de la raíz si `.dev.vars` no las trae; `APP_MODE` y los modelos tienen que estar en `.dev.vars`.
2. Pon las tarifas del modelo elegido en USD por millón de tokens: `MODEL_INPUT_USD_PER_MILLION` y `MODEL_OUTPUT_USD_PER_MILLION`; `EVALUATOR_*` si el evaluador es otro modelo, y `RESEARCH_*` para la investigación. Sirven para el coste mostrado y para reservar presupuesto. Sin tarifa, el coste mostrado queda `null`, salvo los perfiles Anthropic conocidos (Haiku/Sonnet/Opus), que tienen tarifas documentadas. En el perfil público las tarifas explícitas siguen siendo obligatorias para reservar. Un perfil con presupuesto, como el publicado o `bun run dev:real`, no admite consultas sin tarifa.
3. `bun run preflight` muestra el proveedor, el razonamiento y si está la clave, sin enseñarla ni llamar a la red.
4. Arranca con `bun run dev`. Sin RAG solo necesita lo anterior. RAG básico y CRAG necesitan además los bindings de Cloudflare.

Razonamiento. Sin `LLM_REASONING_EFFORT`, cada ruta pide poco razonamiento para que la respuesta quepa en su tope de tokens y en el plazo de 20 segundos de CRAG. Anthropic usa `effort: low`, como la versión publicada. OpenAI y Gemini reciben `low` y el AI SDK lo traduce o lo omite si el modelo no razona. En `compatible` no se envía. En OpenRouter el código lee una vez la ficha del modelo en el catálogo público, sin clave ni coste. Apaga el razonamiento si el modelo lo permite, pide su nivel más bajo si razona siempre y no envía nada si no razona. Con `LLM_REASONING_EFFORT` (`none`, `minimal`, `low`, `medium`, `high`, `xhigh` o `max`) todas las rutas envían ese nivel. Con `omitir`, ninguna lo envía.

Visión. Con `anthropic` se admite la lista de Claude con imagen documentada. Con otro proveedor vale cualquier modelo que acepte imágenes. El código no lo comprueba antes: si el modelo no admite imágenes, la lectura queda como error de visión.

Lo que no cambia con `LLM_PROVIDER`: los embeddings (`EMBEDDING_MODEL`, BGE-M3 de Workers AI), la transcripción y la voz (`RESEARCH_STT_MODEL_ID` y `RESEARCH_TTS_MODEL_ID`, también Workers AI) y la búsqueda externa (`RESEARCH_SEARCH_PROVIDER`). Cambiar el modelo de embeddings exige otro índice, una ingesta y un perfil nuevo: [plan de recursos](docs/cloud-activation-plan.md). Los scripts de verificación del despliegue (`bun run activate` y `scripts/evaluate-*.ts`) siguen fijados a Claude Haiku 5.5 por Anthropic.

Comprobado el 12 de octubre de 2026 con los módulos reales del Worker. Cada modelo hizo una respuesta sin RAG, la evaluación y la reformulación de CRAG, la respuesta final con citas y un plan de investigación; tres de ellos leyeron además una imagen. Pasaron Claude Haiku 5.5 por Anthropic y, por OpenRouter, Claude Haiku 5.5, GPT-6 Luna, GLM-5.3, Kimi K3, Gemini 3.1 Flash-Lite, DeepSeek V4 Flash, Qwen3.8 Flash, Llama 4 Maverick y Grok 4.7. La mayoría tardó entre 1 y 10 segundos por paso. La evaluación de DeepSeek V4 Flash (18,7 s) y de Llama 4 Maverick (17,4 s) rozó el plazo de 20 segundos: un modelo más lento lo agota y CRAG lo registra como fallo, sin cambiar de modelo. Una reformulación de GPT-6 Luna devolvió una vez un JSON ilegible y pasó en las ocho repeticiones siguientes; el sistema no reintenta. OpenAI directo, Gemini directo y `compatible` se comprueban con pruebas sin red. No es una evaluación de calidad: el catálogo y los modelos cambian.

| Mensaje o síntoma                                   | Qué hacer                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `missing` incluye `OPENROUTER_API_KEY` u otra clave | Pon la clave del proveedor de `LLM_PROVIDER`.                                                                |
| `missing` incluye `LLM_PROVIDER`                    | Usa `anthropic`, `openai`, `openrouter`, `gemini` o `compatible`.                                            |
| `missing` incluye `COMPAT_BASE_URL`                 | Falta la URL o usa `http` hacia otra máquina. La clave solo viaja por https o a `localhost`.                 |
| `missing` incluye `LLM_REASONING_EFFORT`            | El valor no existe. Déjalo vacío o usa uno de los niveles de arriba u `omitir`.                              |
| El proveedor responde 400                           | El modelo rechaza un parámetro. Prueba `LLM_REASONING_EFFORT=omitir`.                                        |
| El proveedor responde 404 o «model not found»       | El ID no existe en esa ruta. En OpenRouter, cópialo de [openrouter.ai/models](https://openrouter.ai/models). |
| CRAG se detiene por plazo                           | El evaluador es lento para 20 segundos. Elige un `EVALUATOR_MODEL_ID` más rápido.                            |

## Hecho y pendiente

Hecho: ruta real sin RAG, RAG básico con citas o rechazo, corpus de S1 a S20 y los dos calendarios, ejecutor de Wrangler por operación, grafo CRAG con plazo único y ordenación aplicada, y el CLI conectado al Worker del puente. `bun run test:entrypoint` lo recorre en local con D1, R2 y un índice emulado. S12 conserva el grafo de investigación de las fases 1 y 2 y suma imagen, audio y voz opcional en la fase 3. Su D1, R2 privado y Workflow se publican en el Worker existente; Tavily es el buscador real configurado con un presupuesto separado de 1 USD total y 0,25 USD por trabajo. El 11 de octubre se verificó el recorrido real con imagen, audio y voz: un informe completo y otro parcial, archivos privados recuperados al recargar y reproducción de MP3. La evidencia y los límites del ensayo están en `docs/s12-cloud-deployment.md`; no es una evaluación general de calidad. Los contratos y límites están en `docs/s12-research-phase1.md`, `docs/s12-research-phase2.md`, `docs/s12-research-phase3.md` y `docs/s12-cloud-deployment.md`.

Pendiente: una prueba real de S12 que consuma el presupuesto autorizado, además de medir las salidas de Tavily, visión, Whisper y Aura con proveedores en vivo. La fase local sigue disponible para la clase y no consume ese presupuesto. El detalle de ocho ejercicios del corpus sigue siendo solo un título.

La memoria de OpenViking sigue pendiente. El detalle está en `docs/decisions.md` y `docs/phase-2-verification.md`.

## Protección de la URL pública

Turnstile Managed aparece solo cuando pide interacción. El servidor aplica cuotas de sesión y red antes del RAG y conserva el presupuesto global. [Explicación docente](material/notas/proteger-un-chat-publico.md). La demo local permanece offline sin CAPTCHA.

## Desarrollo local con servicios reales

`bun run preflight:real` comprueba la configuración privada y `bun run dev:real` arranca el frontend/API en este Mac con la API de Claude y los bindings del curso en Cloudflare. Abrir http://127.0.0.1:5173/. Las variables están en `apps/web/.dev.vars.local`, ignorado por Git; las llamadas consumen el presupuesto existente. `bun run dev` conserva la demo offline. [Detalle del perfil local](docs/desarrollo-local-real.md).
