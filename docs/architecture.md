# Arquitectura

Una sola aplicación sirve el React compilado y la API en el mismo origen.

```text
navegador
  apps/web  ->  Worker (Hono, apps/api)
                  |-- /api/health
                  |-- /api/chat
                  \-- assets estáticos
```

Vite compila el cliente. El plugin de Cloudflare empaqueta el Worker y, en local, lo ejecuta con workerd. `assets.not_found_handling` es `single-page-application` y `/api/*` entra primero al Worker.

## Etapas

1. Sin RAG: en `demo`, un stream etiquetado y sin modelo. En `real`, `streamText` contra la API de Claude con el modelo del servidor. No hay recuperación ni evaluador. El texto ordinario, incluido `items[0]`, no pasa por el filtro de citas.
2. RAG básico: una búsqueda sobre la última pregunta, filtro de audiencia durante la consulta, umbral y respuesta con citas `[cite:id]` o rechazo sin llamada generativa. La reescritura de seguimiento está pendiente. En `demo` el índice es el hash lexical `fixture-token-hash-v1`. En `real` la consulta exige un perfil de índice con estado `ready`, el mismo modelo, la misma dimensión y la métrica cosine.
3. CRAG: el grafo de `docs/crag-graph.md`. En demo usa el mismo grafo con guiones o, en una pregunta libre, el índice lexical. En real exige la configuración de RAG más `EVALUATOR_MODEL_ID`, el perfil `ready` y una sesión de gasto. Si falta, la respuesta es 409 o un error de reserva. No reutiliza RAG básico. Una pregunta de calendario sin cohorte se aclara antes de buscar.
4. Investigación (fase 1 de S12): grafo en primer plano, ligado a la petición. En demo usa guiones y páginas sintéticas. En real queda bloqueada con 409 hasta que exista contabilidad durable del coste total y una autorización de gasto propia. No reserva el presupuesto del RAG. El detalle está en `docs/s12-research-phase1.md`.

El grafo admite como máximo tres recuperaciones y dos reformulaciones. El orden final sigue el ranking validado. `usefulIds` solo decide la pertenencia. El plazo de 20 segundos es el del turno: cada llamada recibe el tiempo restante y un resultado tardío no se acepta.

## Almacenes previstos

| Servicio              | Papel                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------- |
| Workers Static Assets | Aplicación React                                                                      |
| Vectorize             | Embeddings y consulta vectorial                                                       |
| D1                    | Texto de fragmentos, metadatos, versiones del corpus y registros mínimos de ejecución |
| R2                    | Documentos originales y artefactos versionados                                        |
| Workers AI            | Embeddings; candidato inicial `@cf/baai/bge-m3`                                       |
| API de Claude         | Generación, evaluación CRAG e investigación con `claude-haiku-5-5`                    |

La página de BGE-M3 consultada el 3 de octubre de 2026 muestra `@cf/baai/bge-m3`, la entrada `{ text }` y un precio publicado de 0,0118 dólares por millón de tokens de entrada. No publica la dimensión del vector. Otra tabla de AI Search lista 1024 para ese alias; no es una medición de esta cuenta y no autoriza a crear el índice. La dimensión queda pendiente de una sonda. No hay recursos creados en esta fase.

El corpus de alumno preparado es `c3a59a406888b`. Su perfil local de prueba es `p9e8e8e03627e`, familia `fixture`, 128 dimensiones. Un perfil `workers-ai` con otra dimensión no reutiliza ese identificador ni esos vectores.

El archivo `docs/wrangler.cloud.example.jsonc` documenta los nombres de binding. No lo lee Vite. La configuración que sí ejecuta el proyecto es `apps/web/wrangler.jsonc`: solo `APP_MODE=demo`, sin recursos de cuenta. Su `compatibility_date` es `2026-10-02`, la fecha más reciente que Miniflare aceptó en esta verificación.

## Límites de código

`packages/contracts` contiene esquemas Zod que el navegador puede importar. `packages/rag` contiene la canalización y los puertos. Los adaptadores de Workers AI, Vectorize, D1 y R2 viven en `apps/api` y no se llaman al importar el módulo. El navegador no importa la API de Claude, LangGraph, los bindings ni tipos de Bun.

Los identificadores de modelo salen de `MODEL_ID`, `EVALUATOR_MODEL_ID` y `RESEARCH_MODEL_ID`, todos `claude-haiku-5-5`. La fábrica usa `https://api.anthropic.com/v1` y `effort: low`. `/api/chat` la usa cuando el perfil real tiene generación configurada y la prueba no inyecta un modelo. Construir la fábrica no llama a la red.

El uso y el coste desconocidos viajan como `null`. La demostración no inventa un cero.

## Cohortes

La petición lleva `program`, `L/X` o `M/J`. El filtro de audiencia se aplica en la consulta, no solo en el prompt. `program` no lee calendarios. Cada cohorte lee el programa y solo su calendario. Una pregunta de horario sin cohorte pide aclaración y no embebe ni genera.

Abortar corta la espera local del embedding, de la consulta y de la generación. La llamada `run` de Workers AI en los tipos instalados no recibe la señal, así que parar la espera no demuestra que el cómputo remoto se haya cancelado ni que un cargo se anule.

## Activación

El plan de recursos está en `docs/cloud-activation-plan.md`. `bun run activate` y `bun run ingest-plan` no escriben. `status --read` consulta whoami, D1, R2 y Vectorize en la cuenta documentada. `--execute` sale con código 2 si falta el permiso de esa operación. El ejecutor espera el código de Wrangler y no trata una visibilidad tardía como fallo. La métrica sale de `wrangler vectorize get --json`, no del `describe()` del binding. Un listado que no es el array documentado no se interpreta como índice ausente. El preflight distingue bindings ausentes, declarados y configurados. No marca ninguno como alcanzado ni verificado.

`scripts/activate.ts` arranca el puente en `127.0.0.1` para los comandos de datos con `--execute`. El `main` es la ruta absoluta de `apps/api/src/bridge-worker.ts` y el testigo entra por `.dev.vars`, no solo por `process.env`. La sonda remota declararía solo `AI`. El almacenamiento remoto declararía D1, R2 y Vectorize después de leer el uuid real. Wrangler 4.147.0 rechaza Vectorize local, así que la prueba offline usa D1 y R2 nativos y emula el índice dentro del Worker. `remoteBindings` del demo sigue en false. No se ha pasado `remote: true`. `resume()` sin plano sigue siendo la lectura administrativa. `select-active` usa el SQL atómico y una lectura final.
