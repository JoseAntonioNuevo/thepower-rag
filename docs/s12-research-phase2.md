# Investigación, fase 2 de S12

Fecha de esta entrega: 10 de octubre de 2026. Añade conversaciones aisladas, un checkpointer de LangGraph en D1, trabajos asíncronos con Cloudflare Workflows y una contabilidad durable propia. No despliega, no crea recursos remotos y no llama a un proveedor de pago. La fase 1 sigue en `docs/s12-research-phase1.md`. La verificación extractiva del informe no cambia.

## Qué puede hacer el alumno

En el perfil local `bun run dev:research` puede crear una conversación, enviar una investigación y recibir enseguida un identificador de trabajo. Cerrar la página o dejar de consultar el estado no cancela el trabajo. Al recargar ve el progreso y, si ya terminó, el informe. Puede seguir en la misma conversación, abrir otra sin mezclar los datos, cancelar de forma explícita y leer la reserva, el consumo y los cargos desconocidos.

La ejecución terminada no significa informe completo. Un trabajo que acaba bien puede dejar un informe parcial, un rechazo o un error.

## Propiedad anónima

Un `threadId` no es una credencial. Cada lectura y cada cambio comprueba el propietario que firma el servidor.

- En la demostración de loopback la cookie es `thepower-research-owner`. La firma HMAC usa `RESEARCH_OWNER_SECRET`, dura 30 días y solo se acepta en `127.0.0.1` o `localhost`. No lleva `Secure` porque el servidor local es HTTP. No es una cuenta de alumno.
- En real con presupuesto público, el propietario es la cookie `__Host-thepower-session`. Si caduca, un identificador antiguo no devuelve el acceso. Turnstile cuenta como propietario solo si hay modo real, presupuesto público, secreto y origen. En cualquier otro caso hace falta `RESEARCH_OWNER_SECRET`.
- El cuerpo y las cabeceras no pueden elegir el propietario.
- La propiedad no sustituye la protección contra abuso. Crear una conversación, enviar un trabajo, cancelar, recuperar o purgar exige, en real público, el mismo origen, la verificación Turnstile y el cupo de IP y de sesión que el chat. Esas comprobaciones ocurren antes de reservar dinero o arrancar el flujo. Consultar estado, resultado o presupuesto solo comprueba al propietario: no pide otro token ni reserva de nuevo.
- La demostración de loopback no pide Turnstile. Una mutación solo se acepta si el origen de la petición es el del propio servidor local.

El grupo de una conversación no cambia. General sigue sin calendario y pide el grupo. Cambiar de L/X a M/J selecciona otra conversación.

## Memoria y checkpoints

La memoria guarda turnos acotados (12 mensajes de usuario, 8 turnos y 1.200 caracteres de contexto). Sirve para resolver «ese índice» o «el error anterior». No es evidencia del curso y no pisa una fuente. La pregunta original se conserva. Si hace falta, el grafo recibe otra pregunta contextualizada y la traza lo dice. Un trabajo nuevo no hereda contadores, plazo ni evidencia admitida del anterior. Reanudar el mismo trabajo sí conserva contadores, plazo, identificadores de operación y evidencia.

El checkpointer implementa `BaseCheckpointSaver`: `getTuple`, `list`, `put`, `putWrites` y `deleteThread`, con el serializador del paquete. El hilo del checkpoint es `job:<jobId>`, derivado en el servidor. LangGraph escribe el grafo raíz con `checkpoint_ns` vacío. No se guardan clientes, bindings, funciones ni señales.

## Trabajos y operaciones

Estados de ejecución: `queued`, `running`, `complete`, `cancelled`, `attention`, `failed`. El resultado del informe va aparte (`complete`, `partial`, `refused`, `error`, `aborted`, `clarify`).

Rutas, todas autorizadas:

- `GET /api/research/session`
- `POST /api/research/conversations` y `GET` de la lista y de una conversación
- `POST /api/research/conversations/:id/jobs` responde 202
- `GET /api/research/jobs/:id` y `/result`
- `POST /api/research/jobs/:id/cancel` y `/recover`
- `GET /api/research/budget`

La consulta de estado no reserva ni llama al proveedor. Como mucho hay un trabajo activo por conversación. La clave de idempotencia la pone el cliente y se ata al propietario, a la conversación y a la huella de la petición. La misma clave y la misma petición devuelven el mismo trabajo. Otra petición con la misma clave se rechaza.

La fila y la reserva se confirman en D1 antes de crear la instancia de Workflow. El id de la instancia es el del trabajo. Si crear agota el tiempo, no se abre otra investigación: repetir `create` con el mismo id adopta la instancia que ya exista. D1 y Workflow no comparten transacción.

La identidad de una petición es la clave del cliente más la pregunta normalizada, el grupo y el guion. No incluye el historial, porque el primer envío ya lo modifica. La misma petición devuelve el mismo trabajo enseguida, mientras corre, al terminar, al reiniciar el proceso y después de turnos posteriores. Otra pregunta con la misma clave se rechaza. Dos envíos idénticos a la vez dejan un trabajo, una reserva y una instancia.

El flujo solo llama a `runResearchTick`. Cada `step.do` tiene `retries.limit` 0. El grafo de LangGraph sigue decidiendo el plan, las búsquedas, la evaluación y la síntesis. Reanudar el mismo trabajo no reinicia el plazo: `deadline_at` se fija al crear el trabajo (`created_at + 120 s`) y `queue_deadline_at` es `created_at + 60 s`. Pasada la cola, un trabajo que no ha empezado no hace llamadas. Pasado el plazo total, no empieza llamadas nuevas.

## Diario y conciliación

Antes de una operación externa se guarda id, huella, tipo, ordinal y reserva. `dispatched` significa que la llamada puede haber salido. El resultado y el consumo se guardan antes de darla por completada.

- Completada: se reutiliza el resultado.
- Reservada y no enviada: puede seguir con la misma reserva, o liberarse si se cancela antes de enviarla.
- Enviada sin resultado durable: pasa a desconocida. No se reenvía. Una recuperación genérica no demuestra que repetirla sea seguro.
- Interrumpida después de guardar el resultado del paso y el checkpoint, sin operaciones enviadas ni desconocidas: el motivo es `recoverable`. Recuperar continúa el mismo trabajo, el mismo plazo y el mismo plan ya liquidado.
- `reconciliation-required` queda para el cargo ambiguo. Pedir recuperación no convierte en desconocida una operación cuyo ejecutor sigue con el arrendamiento.

No se afirma ejecución exactamente una vez en el proveedor. Los reintentos ocultos del modelo de investigación y de los pasos del flujo están desactivados. El arrendamiento incrementa `lease_token`. Un ejecutor viejo no liquida la operación de otro ni escribe el éxito de un trabajo cancelado.

El resultado durable guarda el resumen, las fuentes y el texto del informe, o una referencia a un artefacto del mismo trabajo si el texto no cabe en la fila. La pantalla pinta ese texto con el renderizador del curso. La memoria de la conversación puede estar recortada y no sustituye un informe que no se guardó. Un resultado antiguo sin texto se muestra como tal.

## Contabilidad

La cuenta `research_accounts` no es `public_budget`. Los importes son microdólares enteros. La admisión es un `INSERT` condicional y un trigger que aborta si la suma de reservado, desconocido y consumido supera el presupuesto. Una actualización que no toca filas no deja un trabajo sin reserva: la transacción revierte.

Se reserva el tope del trabajo antes de ejecutarlo. Cada operación liquida una vez. Un cargo conocido consume su importe. Un cargo desconocido o unos créditos sin USD conservan la reserva y el total no queda completo. Solo lo no enviado libera reserva. La retención borra checkpoints de trabajos ya cerrados sin cargos desconocidos y no pone el presupuesto a cero. Los precios quedan en `price_json` (`research-prices-v1`) y no se recalculan al reiniciar.

La tarifa de investigación es la de `RESEARCH_*`, no la del RAG. Si hay precio por crédito de Firecrawl, la búsqueda y la lectura usan ese crédito y no un fijo más barato. El tope de entrada por llamada cuenta memoria, prompt y evidencia.

## Capacidad real

`APP_MODE=real` solo queda `ready` si hay `RESEARCH_DB`, `RESEARCH_WORKFLOW`, el esquema se puede preparar, precios y tope por trabajo, autorización `RESEARCH_SPEND_AUTHORIZATION=s12-research-phase1`, presupuesto propio y propietario, además de los bindings del curso. El propietario de Turnstile solo vale con presupuesto público, secreto y origen; si no, falta `RESEARCH_OWNER_SECRET`. Si falta algo, la respuesta es 409. No hay guion ni ejecución en primer plano. La autorización del RAG no autoriza este gasto. Este documento no autoriza llamadas de pago.

`/api/chat` con modo investigación, cuando el perfil durable está presente, no ejecuta el grafo. La demo sin esos bindings sigue el recorrido de la fase 1.

## Perfil local

```sh
bun run dev:research
bun run preflight:research
```

Queda en `http://127.0.0.1:5191/`. La persistencia es `apps/web/.wrangler/research-state`. No usa los bindings remotos de `env.local` ni copia la clave de Claude. Los adaptadores son los de prueba. El presupuesto de ese perfil es una cuenta de laboratorio, no un cargo.

`apps/api/migrations-research/0001_research_durable.sql` es la migración aditiva. No reescribe las del curso. El Worker aplica las mismas sentencias al arrancar el perfil. No hay activación remota de esa base.

## Evidencia de esta entrega

Comprobaciones locales del 10 de octubre de 2026, sin proveedor de pago:

- `vp check`: 278 archivos con formato correcto; sin avisos ni errores de lint o tipos en 171 archivos.
- `bun run test`: 193 pruebas en 36 archivos, todas pasaron.
- `bun run build`: cliente y Worker generados.
- `bun run preflight` y `bun run preflight -- --capability research`: código 0, demo, investigación `offline-fixture`.
- `bun run preflight:research`: código 0. La clave de Claude no entra en la configuración efectiva de ese perfil.
- `bun run test:entrypoint`: 5 pruebas en 3 archivos, todas pasaron. Incluye el arranque durable con D1 y Workflows locales.

La prueba de workerd usa D1 y Workflows de verdad, con `--persist-to`. Recibe 202, termina el trabajo después de la petición, reinicia con el mismo directorio y deja la operación ambigua en conciliación. La prueba de SQLite local cubre el checkpointer, el presupuesto atómico, el arrendamiento, la cancelación y la retención.

En el navegador, contra `http://127.0.0.1:5191/` en el perfil de investigación:

- Conversación nueva, guion de evidencia suficiente: ejecución terminada e informe completo de prueba, con fuentes sintéticas.
- Recarga: el mismo informe vuelve desde D1.
- Seguimiento «¿y ese índice?»: la pregunta original se conserva y la traza dice que la pregunta del grafo está contextualizada.
- Otra conversación no muestra ese informe.
- Guion de búsqueda lenta cancelado: ejecución cancelada, resultado `aborted`, y 0,002 USD desconocidos que no se liberan.
- Guion ambiguo: ejecución `attention` con conciliación requerida. El total en USD no queda completo.

## Qué no queda verificado

No hay durabilidad en la cuenta de Cloudflare, ni calidad de un modelo o de Firecrawl, ni cancelación de un cargo ya aceptado por un proveedor. Una operación desconocida sigue reservada hasta una conciliación que esta fase no automatiza con el proveedor. Imagen, audio y voz siguen en la fase 3.

Referencias usadas al implementar, contrastadas con los tipos instalados (`@langchain/langgraph` 1.4.18, workers-types `5.20261002.1`, Wrangler 4.147.0):

- [Checkpointers de LangGraph.js](https://docs.langchain.com/oss/javascript/langgraph/checkpointers)
- [Persistencia de LangGraph.js](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
- [API de D1](https://developers.cloudflare.com/d1/worker-api/d1-database/)
