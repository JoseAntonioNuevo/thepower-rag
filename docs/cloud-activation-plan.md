# Plan de activación en Cloudflare

Este documento prepara la activación. No crea recursos. La configuración que ejecuta el proyecto sigue siendo `apps/web/wrangler.jsonc` con `APP_MODE=demo` y sin `account_id`.

## Cuenta de destino

El usuario eligió la cuenta asociada a joseantonionuevo@gmail.com. El ejemplo `docs/activation.example.json` guarda el id `9c1493e94ba21f2c6872a9dd17ba19f7` y el nombre `Joseantonionuevo@gmail.com's Account`. El login puede ver más de una cuenta. Cada comando pasa `CLOUDFLARE_ACCOUNT_ID` y un config temporal con ese id. No se elige la primera cuenta. El archivo local `apps/web/.activation.json` puede repetir esos campos. Con las banderas de alta en false y sin tope, no autoriza escrituras.

## Autorización que falta

Hace falta, en ese archivo y sin secretos:

- `allowCreateD1`, `allowCreateR2` y `allowCreateVectorize` en true, solo para los nombres de abajo, si se van a crear.
- `allowWorkersAi` para la sonda y la ingesta de embeddings.
- `allowOpenRouter` y `modelId` solo para la verificación generativa. El servidor no sustituye otro modelo.
- `maxSpendUsd` finito. El tope lo pone quien autoriza. Este plan no lo inventa. Guardarlo no demuestra que el gasto esté controlado.
- `allowPlanChange` en false. No se cambia de plan ni de suscripción.
- `observedDimensions` como entero positivo solo después de la sonda. Sin ese número no se crea el índice ni se ingesta.

Una sonda no pide permiso de OpenRouter ni de creación. Una lectura no pide tope. Una alta o una llamada de pago sí. Un login de Wrangler, una clave existente o `APP_MODE=real` no sustituyen el permiso. `bun run activate -- ingest --execute` sale con código 2 mientras falte.

`probe-embeddings`, `ingest`, `resume`, `select-active` y `verify` arrancan el puente si `--execute` trae la autorización de esa operación. Sin ella no abren el puerto ni usan el índice lexical. La sonda remota llevaría solo el binding `AI`. El almacenamiento remoto llevaría D1, R2 y Vectorize con el uuid leído, no inventado. Wrangler 4.147.0 no sirve Vectorize en local; la prueba `bun run test:entrypoint` usa D1 y R2 de workerd y un índice emulado. `resume()` sin plano sigue siendo la lectura administrativa. Un JSON de `vectorize list` que no sea un array de índices, o un listado de metadatos sin `propertyName`, es lectura no confirmada y no dispara un `create`.

## Recursos

| Recurso   | Nombre                                       | Papel                                                                                            |
| --------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| D1        | `thepower-ai-course-rag-d1`                  | Documentos, fragmentos, perfiles y diario de ingesta                                             |
| R2        | `thepower-ai-course-rag-corpus`              | Bucket privado. Documentos y manifiesto de contenido inmutables. Cada perfil tiene su manifiesto |
| Vectorize | `thepower-ai-course-rag-<12 hex del perfil>` | Un índice cosine con la dimensión observada                                                      |

El prefijo más los 12 hexadecimales del perfil ocupa 36 bytes. El límite actual de nombre es 64 bytes. La guía de estilo de Vectorize recomienda menos de 32 caracteres; este nombre sigue el espacio pedido para el curso y cabe en el límite duro.

Los bindings del Worker, cuando existan, se llaman exactamente `AI`, `VECTORIZE`, `DB` y `CORPUS`. Un array con otro nombre no cuenta como declarado.

## Límites consultados

Página de límites de Vectorize, `dateModified` 2026-08-05, tabla vigente y no la de índices V1:

- Dimensión máxima 1536, float32.
- Identificador de vector: 64 bytes.
- Metadatos por vector: 10 KiB.
- Como máximo 10 índices de metadatos. Cada valor de texto indexado usa los primeros 64 bytes.
- `topK` con metadatos: 50. Esta aplicación pide 4.
- Lote de upsert desde un Worker: 1000 vectores.
- Vectores por índice: 20 millones en la tabla vigente.

Los identificadores de fragmento de esta preparación caben en 64 bytes y se usan también como identificadores de vector. El mapa `vector_map` guarda la pareja aunque sea la misma cadena. Si un identificador futuro no cupiera, la preparación falla en vez de compactarlo en silencio.

Hay que crear los índices de metadatos `corpusVersion`, `audience` y `profileId` antes de insertar. La documentación de introducción dice que el alta devuelve un identificador de mutación y que la visibilidad tarda unos segundos. `list-metadata-index` debe mostrar los tres nombres antes del upsert.

`Vectorize.describe()` en `@cloudflare/workers-types` 5.20261002.1 devuelve dimensión y `vectorCount`, no la métrica. Eso no impide leerla. `GET /accounts/{account_id}/vectorize/v2/indexes/{index_name}` devuelve `result.config.dimensions` y `result.config.metric`. Wrangler 4.147.0 lo expone con `wrangler vectorize get <nombre> --json` y imprime el objeto del índice, no el sobre de la API. El ejecutor solo acepta la métrica que venga en esa respuesta. Si no viene, no escribe `cosine`.

`wrangler vectorize upsert --json` imprime `{ index, count }` y omite el id de mutación. Sin `--json`, el registro trae `Mutation changeset identifier`. El ejecutor exige ese texto. No ordena esos id.

Una lectura vacía justo después de un upsert aceptado queda en `pending-visibility`. El diario guarda el id de cada lote. La reanudación no vuelve a insertar esos lotes. `get_by_ids` no publica un tope menor que el lote de 1000 del binding ni que la página de `list-vectors`. Las lecturas se parten en lotes de 1000.

Wrangler 4.147.0 no tiene `wrangler ai run`. La sonda no se disfraza con otro subcomando. El precio de la página de BGE-M3, 0,0118 dólares por millón de tokens de entrada, solo estima un máximo. No es una factura y no autoriza la llamada.

## BGE-M3

La página del modelo documenta `@cf/baai/bge-m3`, la entrada `{ text: string[] }` y 0,0118 dólares por millón de tokens de entrada. No documenta la anchura del vector. El esquema de salida síncrona consultado no la trae. La tabla de modelos de AI Search anota 1024 para ese alias. Eso no es una sonda de esta cuenta.

La sonda prevista usa dos textos sintéticos cortos, comprueba que todas las filas sean finitas y de la misma anchura, y guarda la fecha. `remoteRevision` sigue en null si el servicio no la expone. No se inicializa un índice de 768 ni se copia el 128 del hash de prueba.

## Operaciones, por separado

Desde este directorio, con el Wrangler 4.147.0 del proyecto y no con `npx wrangler@latest`:

```sh
bun run activate -- plan
bun run activate -- status --read
bun run activate -- probe-embeddings --execute
bun run activate -- provision --execute
bun run activate -- migrate --execute
bun run activate -- ingest --execute
bun run activate -- resume --execute --profile=<perfil>
bun run activate -- select-active --execute --profile=<perfil>
bun run activate -- verify --execute
```

Sin `--execute` ni `--read` no hay red. `status --read` no escribe. `--execute` espera el código de salida y un resultado validado. Un código distinto de cero no se convierte en éxito. Las claves de R2 del perfil son `corpus/<preparación>/profiles/<perfil>/manifest.json` y `index-config.json`. El manifiesto de contenido es `corpus/<preparación>/content-manifest.json`.

Cuando esa ejecución se autorice, el ejecutor usa el Wrangler 4.147.0 de `apps/web/node_modules/wrangler/bin/wrangler.js`, con argumentos en lista y `CLOUDFLARE_ACCOUNT_ID` fijado. No usa `npx wrangler@latest` ni `--update-config`. El orden es crear solo lo que falte, migrar y luego leer:

```sh
wrangler d1 create thepower-ai-course-rag-d1
wrangler d1 migrations apply thepower-ai-course-rag-d1 --remote
wrangler r2 bucket create thepower-ai-course-rag-corpus
wrangler vectorize create <nombre> --dimensions=<observada> --metric=cosine
wrangler vectorize create-metadata-index <nombre> --propertyName=corpusVersion --type=string
wrangler vectorize create-metadata-index <nombre> --propertyName=audience --type=string
wrangler vectorize create-metadata-index <nombre> --propertyName=profileId --type=string
wrangler vectorize list-metadata-index <nombre> --json
wrangler vectorize get <nombre> --json
```

La ayuda instalada nombra la opción `--propertyName`. El nombre del índice sale de `vectorizeIndexName` sobre el perfil semántico, no de un id de ejemplo. Los identificadores que devuelva la cuenta sustituyen a los marcadores de `docs/wrangler.cloud.example.jsonc`. Las migraciones son `0001_corpus.sql`, `0002_index_profile.sql` y `0003_ingest_journal.sql`. No se borra una versión anterior. La versión activa solo cambia con `select-active` y solo si el perfil está `ready`. Un perfil ya activo no se reingesta al consultar su estado.

## Uso previsto, sin tratarlo como gratis

El corpus local tiene 22 documentos de alumno. La ingesta sería un lote de embeddings de esos fragmentos, más dos textos de sonda. La generación dirigida, si se autoriza después, queda en como máximo cuatro llamadas con `maxOutputTokens` 600 y `maxRetries` 0. El precio de OpenRouter depende del `modelId` y no se inventa aquí. Hay que parar antes del `maxSpendUsd` autorizado. Un uso desconocido no es cero.

No hay endpoint público de ingesta. No se despliega la aplicación en esta fase. `remoteBindings` del build de demo sigue en false. El puente solo acepta `127.0.0.1` y un testigo de esa ejecución. La verificación real llama a `/api/chat` de ese runtime; el arnés con modelo simulado queda marcado como fixture. Un arranque con `remote: true` haría llamadas reales y no se ha hecho. `describe()` del binding no sustituye a `vectorize get`. El tope de la sesión no es un tope de toda la cuenta.
