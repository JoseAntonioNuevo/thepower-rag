# Verificación de la fase 7

Fecha de las comprobaciones: 3 de octubre de 2026. Node del sistema v24.16.0. Bun 1.4.2. No hubo alta de recursos, despliegue, commit ni llamada de pago.

## Qué cambió

`scripts/activate.ts` construye el plano cuando el comando es de datos y lleva `--execute` con la autorización de esa operación. `plan` y la lectura no lo arrancan.

El Worker del puente exporta `fetch`. El `main` del config temporal es la ruta absoluta de `apps/api/src/bridge-worker.ts`. `BRIDGE_TOKEN` entra por `.dev.vars` junto a ese config, con permiso `0600`, y no va en argumentos ni en el proceso como único canal. El arranque reintenta si la conexión se rechaza al principio, falla enseguida si el proceso hijo termina o el testigo no vale, y al cerrar mata solo ese hijo y borra el config temporal.

Wrangler 4.147.0 no admite Vectorize en local. La sonda remota, cuando esté autorizada, declara solo `AI`. El almacenamiento remoto declara D1, R2 y Vectorize con el uuid que devuelva `d1 info`, sin inventar uno. La prueba offline usa D1 y R2 nativos de workerd y un índice vectorial emulado dentro del Worker, porque el binding local de Vectorize no arranca. `remoteBindings` del demo sigue en false. No se pasa `--remote` ni `--tunnel`.

La procedencia sale del adaptador que ejecutó la operación: `fixture`, `local-native-emulation` o `remote-binding`. Una caché de otra procedencia no se reutiliza aunque coincidan dimensión y perfil. La dimensión 32 de la emulación no sirve para crear un índice remoto. El cuerpo de los documentos no está en `corpus.json`; la ingesta lo lee de `corpus/sources` y el Worker comprueba `sourceHash`.

`runVerificationSession` sigue siendo el arnés de dobles y queda marcado como `fixture`. `verify` del CLI llama a `/api/chat` del mismo runtime. La sesión de gasto se guarda y se restaura; una segunda sonda no reinicia el tope.

## Comandos

```sh
bun install --frozen-lockfile
bun run check
bun run test
bun run test:entrypoint
bun run build
bun run preflight
bun run preflight -- --capability sin-rag
bun run preflight -- --capability rag
bun run preflight -- --capability crag
bun run activate
bun run activate -- plan
```

Con tope, modelo y permisos, y solo entonces:

```sh
bun run activate -- probe-embeddings --execute
bun run activate -- ingest --execute
bun run activate -- resume --execute --profile=<perfil>
bun run activate -- select-active --execute --profile=<perfil>
bun run activate -- verify --execute
```

Sin esa autorización el `--execute` sale con código 2 y no arranca el puente.

## Resultados locales

- Instalación congelada: 183 instalaciones, 335 paquetes, sin cambios.
- `check`: formato, lint y tipos sin avisos en 92 archivos TypeScript.
- `test`: 80 pruebas en 17 archivos. No abren la red.
- `test:entrypoint`: 3 pruebas. Workerd en `127.0.0.1` rechazó un testigo distinto, aceptó el de la ejecución y cerró el puerto. El CLI hizo la sonda emulada, la ingesta, la reanudación sin reembeber, la selección por SQL de D1 y la verificación HTTP. La segunda sonda, con el tope ya reservado, no llamó al emulador. Procedencia `local-native-emulation`, `live` false, `usableForRemoteIndex` false.
- `build`: el Worker de la aplicación sigue en 3.098,94 kB. El puente no entra en ese bundle. No es un despliegue.
- Preflight demo, sin RAG, RAG y CRAG: código 0. Siguen en demostración.
- `activate` y `activate -- plan`: código 0, sin red.

## Lo que no está verificado

- No se arrancó el puente con `remote: true`. Esa arrancada hablaría con Workers AI, D1, R2 y Vectorize.
- No hay dimensión observada de BGE-M3, ni uuid de D1, ni umbral semántico. El 0,55 del emulador local no es ese umbral. El 0,33 tampoco.
- Faltan `maxSpendUsd`, `MODEL_ID` y los permisos de Workers AI, OpenRouter y de crear solo los tres recursos del curso. `allowPlanChange` sigue en false.
- El tope de la sesión no es un tope de toda la cuenta.
- No hubo commit, push ni despliegue. OpenViking sigue sin cuenta para este directorio.
