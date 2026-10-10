# Estado publicado · 3 de octubre de 2026

Aplicación real: https://rag-thepower.josenuevo.dev. Sin RAG, RAG básico y CRAG usan los servicios remotos. [Operación y límites verificados](docs/despliegue-real.md). [Comparación de 40 respuestas](material/comparacion/resultados/tabla-resultados.md). El arranque local sigue siendo una demo offline.

# Asistente RAG del AI Engineer

Proyecto de clase para The Power. El producto será un asistente en español del programa completo de AI Engineer, de la sesión 1 a la 20. Cada respuesta con recuperación debe citar sus documentos y reconocer lo que no consta.

El temario de S1 a S20 y los dos calendarios de AI Engineer están en el corpus. El detalle de varios ejercicios sigue siendo solo un título. La cobertura generada está en `corpus/COVERAGE.md`. El índice remoto no está creado.

## Dos clases, tres etapas

S10, el 22 de octubre de 2026, cubre las dos primeras etapas. S11, el 27 de octubre de 2026, evoluciona la misma aplicación.

1. **Sin RAG.** Conversación sin documentos. En demo es un stream sin modelo. En real llama a OpenRouter.
2. **RAG básico.** Una búsqueda, un umbral y una respuesta con fuentes, un rechazo o una petición de cohorte.
3. **CRAG.** Un grafo correctivo con tres búsquedas y dos reformulaciones como máximo, un solo plazo de 20 segundos y la ordenación validada. En demo usa guiones. En real, si falta configuración o una sesión de gasto, no llama al proveedor y no usa otra etapa.

## Arquitectura

El navegador habla con un único Worker. Workers Static Assets sirve React. Hono atiende `/api/*`.

- Vectorize consultará embeddings cuando exista el índice.
- D1 guardará texto, metadatos y versiones.
- R2 guardará originales y manifiestos.
- Workers AI es el candidato de embeddings con `@cf/baai/bge-m3`. Su dimensión no está medida.
- La API de Claude genera con `claude-haiku-5-5`. El evaluador de CRAG usa el mismo modelo.

El perfil demo no usa esos servicios. Usa un índice lexical de 128 dimensiones, etiquetado como prueba. No es una búsqueda semántica ni Vectorize.

Esta adaptación sustituye el diseño anterior con PostgreSQL y pgvector. No hay una segunda implementación.

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

| Nombre                 | Uso                                         |
| ---------------------- | ------------------------------------------- |
| `APP_MODE`             | `demo` o `real`                             |
| `ANTHROPIC_API_KEY`    | Clave de la API de Claude. Va en `.env`     |
| `MODEL_ID`             | Modelo generativo del servidor              |
| `EMBEDDING_MODEL`      | Modelo de embeddings del RAG real           |
| `EMBEDDING_DIMENSIONS` | Dimensión observada, no supuesta            |
| `CORPUS_VERSION`       | Versión de preparación que se consulta      |
| `INDEX_PROFILE`        | Perfil de índice, distinto del hash lexical |
| `VECTOR_METRIC`        | Debe ser `cosine` en el perfil real         |
| `MIN_RETRIEVAL_SCORE`  | Umbral calibrado del índice que se use      |
| `EVALUATOR_MODEL_ID`   | Solo CRAG real. No bloquea las otras etapas |

La generación configurada no implica que el RAG esté listo. El umbral 0,33 pertenece solo al coseno lexical de la demostración. El 0,55 del emulador local tampoco es un umbral de BGE-M3. El plan de recursos y los comandos están en `docs/cloud-activation-plan.md`. La evidencia de la fase 7 está en `docs/phase-7-verification.md`. Las fases anteriores siguen en sus documentos.

Los secretos van en `apps/web/.dev.vars`. Ese archivo y cualquier `.dev.vars*` quedan fuera de Git, salvo `.dev.vars.example`. No uses `VITE_*` para secretos.

En local, `.dev.vars` sustituye las claves repetidas de `vars`. El entorno del proceso no entra en el Worker. `bun run preflight` muestra nombres y perfiles, no valores, y no abre conexiones. Si `APP_MODE=real` y falta la generación, el código de salida es 2.

El Worker ejecutable no declara base de datos, índice ni bucket. Los nombres futuros están en `docs/wrangler.cloud.example.jsonc`, que el desarrollo no carga.

Cuando el perfil real tenga `ANTHROPIC_API_KEY` y `MODEL_ID`, sin RAG llamará a la API de Claude con `claude-haiku-5-5`. RAG real llamará además a Workers AI, Vectorize y D1.

## Hecho y pendiente

Hecho: ruta real sin RAG, RAG básico con citas o rechazo, corpus de S1 a S20 y los dos calendarios, ejecutor de Wrangler por operación, grafo CRAG con plazo único y ordenación aplicada, y el CLI conectado al Worker del puente. `bun run test:entrypoint` lo recorre en local con D1, R2 y un índice emulado. La investigación de S12, fase 1, corre en demo con guiones; la real sigue bloqueada. El contrato está en `docs/s12-research-phase1.md`.

Pendiente de ejecución real: tope de gasto, permiso de alta y de Workers AI, arranque con `remote: true`, sonda de BGE-M3, recursos, umbral semántico y la comparación reservada. Sin esa autorización el `--execute` no abre el puente. El detalle de ocho ejercicios sigue siendo solo un título. No se han creado recursos nuevos ni se ha desplegado este cambio de modelo.

La memoria de OpenViking sigue pendiente. El detalle está en `docs/decisions.md` y `docs/phase-2-verification.md`.

## Protección de la URL pública

Turnstile Managed aparece solo cuando pide interacción. El servidor aplica cuotas de sesión y red antes del RAG y conserva el presupuesto global. [Explicación docente](material/notas/proteger-un-chat-publico.md). La demo local permanece offline sin CAPTCHA.

## Desarrollo local con servicios reales

`bun run preflight:real` comprueba la configuración privada y `bun run dev:real` arranca el frontend/API en este Mac con OpenRouter y los bindings del curso en Cloudflare. Abrir http://127.0.0.1:5173/. Las variables están en `apps/web/.dev.vars.local`, ignorado por Git; las llamadas consumen el presupuesto existente. `bun run dev` conserva la demo offline. [Detalle del perfil local](docs/desarrollo-local-real.md).
