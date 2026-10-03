# Decisiones

## Vectorize en lugar de pgvector

El ejercicio anterior pedía PostgreSQL con pgvector y documentos de una empresa ficticia. Para este demostrador se autorizó Cloudflare: Vectorize, D1, R2 y Workers AI, con el curso real como corpus futuro. No hay una segunda implementación con Neon, Supabase ni pgvector. Los documentos históricos del directorio padre no se reescriben.

## Un Worker y el AI SDK

La interfaz es React con Vite+. La API es Hono dentro del mismo Worker. El estado de chat usa `@ai-sdk/react` y el protocolo UI Message Stream. No se instala TanStack AI, Next.js ni el AI Gateway de Vercel. El modelo, cuando exista la llamada, sale de `@openrouter/ai-sdk-provider` con URL y compatibilidad explícitas.

LangGraph ejecuta el grafo de CRAG en cada turno de esa etapa. La comprobación de compatibilidad solo mira que el paquete carga. No es una activación remota.

`compatibility_date` queda en `2026-10-02`. Miniflare de wrangler 4.147.0 compara la fecha con `new Date().toISOString()` en UTC. En la noche del 3 de octubre en Madrid, UTC seguía en el 2 de octubre, así que `2026-10-03` se rechazó como fecha futura y el servidor local no arrancaba. La fecha elegida es la más reciente que ese runtime acepta durante esta verificación.

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

## Qué queda fuera

No hay contenedores, FastAPI, Redis, colas, Durable Objects, Agents SDK ni AI Search. No se elige un modelo de pago por omisión. El modo real incompleto no cae a la demostración.

## OpenViking

El 3 de octubre de 2026 el selector `~/.config/openviking/workspace-account.sh` no tiene una cuenta para `/Users/jose/Documents/the-power` ni para `3-rag`. Esas rutas tampoco son un checkout de las cuentas registradas. En las fases 2 y 3, `http://127.0.0.1:11933/health` no aceptó conexión. Al abrir y al cerrar la fase 4, al cerrar la fase 5, al abrir la fase 6 y al abrir y cerrar la fase 7, el túnel respondió HTTP 200, pero el selector siguió saliendo con código 1 para `3-rag` y la salud no trajo `account_id`. No se ha inventado una cuenta ni se ha escrito en otro tenant. La entrega de memoria queda pendiente hasta que exista un mapeo verificado para este proyecto.
