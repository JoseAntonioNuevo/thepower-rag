# Decisiones

## Demostrador en Vectorize y laboratorio reproducible en PostgreSQL/pgvector

El ejercicio publicado de S10 y S11 pide al menos ocho documentos ficticios, PostgreSQL con `pgvector`, columna `vector(768)` e índice HNSW, reconstrucción desde índice vacío, separación entre reordenamiento y valoración de suficiencia en CRAG y una evaluación ejecutada de 20 preguntas (14 respondibles y 6 sin respuesta).

Para cubrir tanto la demostración del curso como el ejercicio publicado sin contaminar el Worker de Cloudflare:

1. **Demostrador del curso (`apps/api`, `apps/web`):** mantiene Cloudflare Vectorize (`1024` dimensiones con BGE-M3), D1, R2 y Workers AI sobre el temario real S1–S20 y los calendarios L/X y M/J, con `RAG_CONTEXT_MODE=semantic` como referencia principal de S10 (y `RAG_CONTEXT_MODE=complete` como variante para corpus pequeños) y el grafo CRAG con nodos `rank` y `assess` separados y escala `[0, 1]` (`CRAG_SCORE_THRESHOLDS`).
2. **Laboratorio reproducible del ejercicio (`lab/`):** acompaña al demostrador con 10 documentos ficticios de AetherCloud (`lab/corpus/sources/`), `lab/schema.sql` (`CREATE EXTENSION IF NOT EXISTS vector`, `embedding vector(768) NOT NULL`, `USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`), `lab/docker-compose.yml` (`pgvector/pgvector:pg17`), `lab/src/rag-basic.ts`, `lab/src/crag-graph.ts` (LangGraph.js con `retrieve → rerank → assess` separados y plantilla opcional `Qwen3-Reranker-0.6B`) y la evaluación ejecutada de 20 preguntas en `lab/eval/resultados-laboratorio.md`, usando el driver SQL nativo de Bun sin añadir paquetes de PostgreSQL a `package.json`.

## Un Worker y el AI SDK

La interfaz es React con Vite+. La API es Hono dentro del mismo Worker. El estado de chat usa `@ai-sdk/react` y el protocolo UI Message Stream. No se instala TanStack AI, Next.js ni el AI Gateway de Vercel. El modelo sale de `@ai-sdk/anthropic` contra `https://api.anthropic.com/v1`. No se pasa un id suelto que enrute por el gateway.

LangGraph ejecuta el grafo de CRAG en cada turno de esa etapa. La comprobación de compatibilidad solo mira que el paquete carga. No es una activación remota.

`compatibility_date` queda en `2026-10-02`. Miniflare de wrangler 4.147.0 compara la fecha con `new Date().toISOString()` en UTC. En la noche del 3 de octubre en Madrid, UTC seguía en el 2 de octubre, así que `2026-10-03` se rechazó como fecha futura y el servidor local no arrancaba. La fecha elegida es la más reciente que ese runtime acepta durante esta verificación.

## Cualquier proveedor de modelos

Desde el 12 de octubre de 2026, `LLM_PROVIDER` elige el proveedor de todos los papeles generativos: `anthropic` (por defecto), `openai`, `openrouter`, `gemini` o `compatible`. Cada papel conserva su variable de modelo. La versión publicada no cambia: sin la variable sigue Claude Haiku 5.5 por la API de Anthropic con `effort: low`.

Se usan los paquetes del AI SDK de la misma serie que `@ai-sdk/anthropic` 4.0.78 (`@ai-sdk/openai` 4.0.91, `@ai-sdk/google` 4.0.93 y `@ai-sdk/openai-compatible` 3.0.67) y `@openrouter/ai-sdk-provider` 3.1.0, que el proyecto ya usó con OpenRouter. El Worker comprimido pasa de 808 KB a 994 KB.

El razonamiento por defecto es bajo en todas las rutas. En OpenRouter, un nivel bajo que el modelo no admite sube al más cercano, y en DeepSeek V4 Flash eso es `high`: agotaba el plazo de CRAG y el tope de salida del plan. Por eso esa ruta lee una vez el catálogo público. Apaga el razonamiento si el modelo lo permite, pide su nivel más bajo si razona siempre y no envía nada si no razona. Si el catálogo falla, pide el nivel bajo.

El coste mostrado usa `MODEL_*_USD_PER_MILLION` y el consumo estimado de la investigación y la visión usa `RESEARCH_*_USD_PER_MILLION`, las mismas tarifas con las que se reserva. Antes se calculaban siempre con la tarifa de Haiku. Con otro modelo sin tarifa, el coste mostrado queda desconocido. CRAG pasa ahora al evaluador y al generador los ajustes completos del proveedor, incluido el espacio de trabajo de Anthropic que antes omitía.

Los embeddings, la voz y la transcripción siguen en Workers AI. Los scripts de verificación del despliegue siguen fijados a Claude Haiku 5.5.

## Fase 2: generación y RAG básico

Sin RAG real usa OpenRouter con `MODEL_ID` y la clave. No exige `EVALUATOR_MODEL_ID`. RAG básico recupera una sola vez y, si el umbral no deja contexto, no llama al modelo. CRAG real pide además el evaluador y no bloquea las otras etapas cuando falta.

El perfil `demo` conserva la demostración sin modelo y añade una canalización lexical de prueba. No es BGE-M3 ni Vectorize. Un perfil `real` incompleto no vuelve a esa demostración.

La configuración local efectiva es `vars` de `apps/web/wrangler.jsonc` sustituida por las claves de `apps/web/.dev.vars`. El entorno del proceso no se mezcla. El preflight usa el mismo parser dotenv 16.3.1 que Wrangler 4.147.0.

El corpus de la fase 2 salía solo de la guía parcial. La fase 3 lo sustituye por el temario del 17 de julio y el calendario de AI Engineer.

## Fase 3: corpus completo de fuentes y preparación de la activación

El temario de las veinte sesiones está normalizado. Los calendarios L/X y M/J salen de la tabla AI Engineer de la imagen, no de Desarrollo Agéntico. Ocho ejercicios siguen en título porque la fuente no trae rúbrica. S9 sigue enseñando PostgreSQL y pgvector. La demostración de S10 no reescribe esa sesión.

La versión de preparación `c3a59a406888b` no cambia si solo cambia el modelo de embeddings. El perfil `p9e8e8e03627e` es el hash lexical de 128 dimensiones. Un perfil semántico tiene otro identificador. El RAG real no consulta un perfil que no esté `ready` ni mezcla familias.

La ingesta escribe el manifiesto serializado, lee R2, D1 y los identificadores de Vectorize, y no acepta un booleano del llamador para declararse lista. `Vectorize.describe()` no devuelve la métrica en los tipos instalados. Sin esa lectura el estado se queda en `pending-visibility`.

No se han creado recursos ni se ha llamado a OpenRouter o Workers AI. La prohibición de acciones de pago sigue en `AGENTS.md`.

## Fase 4: ejecutor y reanudación

El 3 de octubre de 2026 el usuario fijó la cuenta `9c1493e94ba21f2c6872a9dd17ba19f7`. Cada comando de Wrangler recibe `CLOUDFLARE_ACCOUNT_ID` y un config temporal con ese id. No se usa la primera cuenta de la sesión. El correo y el nombre se comprueban contra whoami. Un aviso de scopes no se toma como fallo de una operación concreta.

Una inserción aceptada cuya lectura `getByIds` aún no ve los vectores queda en `pending-visibility`. La reanudación no vuelve a embeber ni a insertar esos lotes. El fallo queda para un rechazo, una métrica distinta, metadatos incongruentes o identificadores que no son los esperados. El diario se escribe en `ingest_items`, con resultado y mutación por lote. El manifiesto de contenido es común e inmutable. El manifiesto de cada perfil vive en `corpus/<preparación>/profiles/<perfil>/`. La métrica que puede marcar `ready` es la de `vectorize get`, no un cosine supuesto. `describe()` del binding sigue sin traerla.

Wrangler 4.147.0 no tiene `ai run`. La sonda de `@cf/baai/bge-m3` no se lanza desde un subcomando inventado ni arrancando un Worker. El precio publicado, 0,0118 dólares por millón de tokens de entrada, sirve para estimar; no es una factura. Sin `maxSpendUsd` y sin `MODEL_ID` no hay alta ni llamada de pago.

## Fase 5: grafo CRAG local

El 3 de octubre de 2026 el grafo correctivo quedó en la misma aplicación. Ordena y evalúa en una sola decisión estructurada por pasada. La generación final, si la evidencia es suficiente, usa el mismo contrato de citas que el RAG básico. Los guiones de S5, S6 y los fallos sintéticos no se presentan como calidad del método. El artículo de CRAG se cita como inspiración.

El listado `wrangler vectorize list --json` tiene que ser un array de objetos con `name`. El de metadatos tiene que traer `propertyName`. Si no, la lectura no está confirmada y no se crea el recurso. `probeEmbeddings()`, `ingest()` y `verify()` continúan en rechazo fijo.

El puerto real de CRAG, en la fase 5, no consultaba un tope de gasto. La fase 6 lo cambia: sin una sesión de gasto inyectada, la reserva rechaza la llamada. Prepararlo no significa que se haya ejecutado. La configuración ejecutable sigue en demo.

## Fase 6: plazo, orden y puente local

El 3 de octubre de 2026 el grafo dejó de aceptar una generación que termina después de los 20 segundos. La ordenación validada ordena el contexto; los ids útiles solo deciden qué entra. El panel no repite la clave de un descarte y no cambia de guion mientras responde. La cita de arXiv:2401.15884 queda en Shi-Qi Yan, Jia-Chen Gu, Yun Zhu y Zhen-Hua Ling. El flujo sigue siendo una adaptación al corpus del curso, no una reproducción ni una mejora medida.

La sonda, la ingesta, la reanudación completa y la verificación llaman a un plano inyectable. Las pruebas de unidad usan bindings en memoria y no abren la red. El presupuesto de esa sesión reserva el peor caso, no trata un precio desconocido como cero y no libera una reserva sin cargo real. No es un tope distribuido de la cuenta. El chat real público sigue sin política de uso.

## Fase 7: el CLI arranca el Worker

El 3 de octubre de 2026 `activate` pasó a construir el puente para los comandos de datos con `--execute`. El módulo tiene `fetch`, el `main` es absoluto y el testigo es un binding de `.dev.vars`. Wrangler 4.147.0 rechaza Vectorize local, así que la integración offline usa D1 y R2 nativos y emula el índice. La procedencia la marca el adaptador usado. La caché de otra procedencia no se reutiliza. La sesión de gasto se restaura entre invocaciones. `bun run test:entrypoint` recorrió ese CLI contra workerd sin red externa. El arranque con `remote: true` no se ha hecho.

## S12 fase 1: investigación en primer plano

El 10 de octubre de 2026 la etapa de investigación quedó en la misma aplicación, sin hilos persistentes, trabajos en la nube, imagen, audio ni voz. El grafo corre mientras la petición sigue abierta. Los adaptadores de prueba no miden un proveedor. La investigación real sigue bloqueada: falta `RESEARCH_DURABLE_ACCOUNTING` y no hereda la autorización ni el presupuesto del RAG. Una respuesta 409 no cae al guion.

Cada cláusula tiene que ser un tramo ordenado de un extracto admitido. El solapamiento de palabras no verifica una negación omitida, un intercambio de cifras ni un hecho añadido al lado de una cláusula que sí reproduce el extracto. La fase 1 no acepta paráfrasis. Una contradicción explícita impide un informe completo y puede abrir la única ronda de seguimiento ya prevista. La evaluación de la segunda ronda recibe la evidencia acumulada y la cobertura previa. Un fallo de `get_course_session` es un fallo operativo; una lectura correcta sin el dato es falta de evidencia. Cancelar la petición deja de esperar en local aunque el adaptador ignore la señal; eso no anula un cargo remoto ya enviado. Los créditos sin un USD verificado no completan el total.

## Generación con Claude Haiku 5.5

El 10 de octubre de 2026 la generación, el evaluador de CRAG y el modelo de investigación pasan a `claude-haiku-5-5` por la API de Claude. La fábrica es `createAnthropic` con `effort: low`. No se envían `temperature`, `top_p` ni `top_k`. El tope de salida del curso queda en 1600 tokens para dejar sitio al pensamiento adaptativo. Las tarifas publicadas para prompts de hasta 100000 tokens son 0,10 USD y 0,50 USD por millón. El presupuesto público sigue en 4,30 USD. Embeddings siguen en Workers AI y Firecrawl no cambia. La clave va en `.env` como `ANTHROPIC_API_KEY`. Una clave de organización envía además `ANTHROPIC_WORKSPACE_ID` en la cabecera `anthropic-workspace-id`.

## Qué queda fuera

No hay contenedores, FastAPI, Redis, colas, Durable Objects, Agents SDK ni AI Search. No se elige un modelo de pago por omisión. El modo real incompleto no cae a la demostración.

## Investigación S12, fase 2

La fase 2 no sustituye el grafo de LangGraph ni el presupuesto `public_budget`. Las conversaciones, los trabajos, el diario de operaciones, los checkpoints y la cuenta de investigación viven en un D1 aparte, binding `RESEARCH_DB`. El ejecutor es un Workflow de Cloudflare cuyo id de instancia es el del trabajo. Cada paso reanuda el mismo grafo con reintentos en cero. Una operación marcada como enviada y sin resultado queda desconocida y no se reenvía. Un checkpoint sin cargo ambiguo se reanuda con `recoverable`. El informe visible sale del resultado guardado, no de la memoria recortada. En real público, las mutaciones pasan por origen, Turnstile y cupo antes de reservar; las lecturas solo comprueban al propietario. La demostración local es `bun run dev:research`. No hay alta remota de esa base.

## Investigación S12, fase 3

La imagen, el audio y la voz opcional entran por el diario y el presupuesto de la fase 2. No sustituyen el grafo ni el verificador extractivo. Los bytes van a un R2 distinto del corpus. Las instantáneas v1 y v2 se interpretan como Firecrawl; la v3 fija además el proveedor de búsqueda para que una recuperación no cambie su precio de forma silenciosa. La visión real usa Claude Haiku 5.5 porque acepta imagen. Whisper y Aura-2 es quedan en Workers AI. El perfil `dev:research` no llama a esos proveedores: el guion depende del hash y la voz local es un tono, no una muestra de Aura. Los adaptadores reales tienen pruebas con dobles. El estado local del 10 de octubre no tenía recursos S12 remotos. El 11 de octubre se crearon el D1 y el R2 privados y se aplicaron ambas migraciones al D1; la configuración de producción añade el Workflow y Tavily. El usuario autorizó 1 USD total y 0,25 USD por trabajo. No se ha enviado una petición de pago para medir calidad. Un USD calculado con tokens no se etiqueta como importe del proveedor; ver `docs/s12-cloud-deployment.md` para el readback vigente.

## OpenViking

El 3 de octubre de 2026 el selector `~/.config/openviking/workspace-account.sh` no tiene una cuenta para `/Users/jose/Documents/the-power` ni para `3-rag`. Esas rutas tampoco son un checkout de las cuentas registradas. En las fases 2 y 3, `http://127.0.0.1:11933/health` no aceptó conexión. Al abrir y al cerrar la fase 4, al cerrar la fase 5, al abrir la fase 6 y al abrir y cerrar la fase 7, el túnel respondió HTTP 200, pero el selector siguió saliendo con código 1 para `3-rag` y la salud no trajo `account_id`. El 10 de octubre de 2026, al abrir la fase 3 de S12, el túnel volvió a responder HTTP 200 y el selector siguió sin mapear este repositorio. No se ha inventado una cuenta ni se ha escrito en otro tenant. La entrega de memoria queda pendiente hasta que exista un mapeo verificado para este proyecto.

## Perfil Sonnet publicado el 18 de octubre de 2026

El generador de RAG/CRAG y el evaluador/reformulador pasan a Sonnet 5.5 (2/10 USD por MTok), sin cambiar BGE-M3 ni la investigación S12. Los dos recorridos comparten generador y plazo de llamada de 30 s; CRAG tiene un plazo global de 60 s, validado y sin reinicio entre nodos. La referencia histórica y la demo mantienen 20 s por defecto. Sonnet 5.5 usa `between_tools` para esfuerzo bajo/medio/alto; Opus 5.5 queda como comparador opcional con `adaptive`, sin fallback automático.

La reserva usa las tarifas correspondientes y conserva todos los límites y saldos. Health expone identidad de modelos, plazos y modo de recuperación sin claves. Los comparadores separan desarrollo y test reservado, conservan resultados por run y rechazan un objetivo remoto con otra configuración. El usuario autorizó publicar y probar con un máximo adicional de 5 USD. Se publicó `c9eae749-6cd4-4911-95a4-3cbb8390d2d9` al 100 %, con health y pruebas web RAG/CRAG completas. Las 28 operaciones dirigidas tuvieron éxito; Sonnet y Opus coincidieron con 5/5 etiquetas previstas, frente a 3/5 de Haiku, sin convertir esta muestra en una tasa general. La cota combinada de reservas fue 4,890118 USD y el saldo público restante, 0,6283574 USD: la próxima consulta CRAG exige 0,9000885 USD y será rechazada por presupuesto. No ampliar ni reiniciar el tope, ni conciliar cargos inciertos usando solo estimaciones de tokens. Ver `docs/evidence/sonnet-quality-2026-10-18.md` y `docs/sonnet-crag.md`. OpenViking sigue pendiente por ausencia de una cuenta mapeada; estas decisiones se conservan localmente.

## Turnstile antes del envío (23 de octubre de 2026)

El cliente verifica bajo demanda con `execution: "execute"` y `appearance: "interaction-only"`. Primero comprueba la sesión; después solicita un token nuevo y solo entonces entrega el mensaje al transporte. Cada intento posee un widget que se retira al terminar. No se precarga el siguiente token ni se renueva por caducidad en reposo. Esto elimina los dos reinicios anteriores: al consumir el token y al terminar el stream. El servidor conserva Siteverify por petición, hostname, acción, sesión, cuotas y presupuesto. La comprobación real añadió hasta dos reintentos nativos de errores transitorios dentro del mismo envío y plazo: no son una renovación anticipada del siguiente mensaje.

El borrador se conserva ante fallo o cancelación, las esperas se cancelan al desmontar y los callbacks de un intento no pueden resolver otro. El botón Cancelar/Detener previene la acción por defecto del clic porque React puede reutilizar ese nodo como botón de envío durante la actualización. La verificación tiene un plazo de dos minutos para admitir interacción humana y no el antiguo límite de veinte segundos.

Estado: publicado el 23 de octubre de 2026 al 100 % en la versión `dc051851-8cd1-41d0-96f5-21843c62ca4e`, código `273641f`, con dos respuestas reales consecutivas en el navegador integrado. [Evidencia y pruebas reproducibles](evidence/turnstile-before-send-2026-10-23.md). El selector de OpenViking sigue sin cuenta para este repositorio; esta nota conserva la decisión localmente sin escribir en otro tenant.
