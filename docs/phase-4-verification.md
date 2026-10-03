# Verificación de la fase 4

Fecha de las comprobaciones: 3 de octubre de 2026. Node del sistema v24.16.0. Bun 1.4.2. No hubo alta de recursos, despliegue, commit ni llamada de pago.

## Qué cambió

- `bun run activate` espera el resultado de cada operación. Un código distinto de cero no se informa como éxito.
- Sin `--execute` ni `--read` no hay red. Cada operación pide solo su permiso: la sonda no exige OpenRouter ni crear recursos; una alta exige tope.
- Una inserción aceptada que todavía no se lee queda en `pending-visibility`. La reanudación no vuelve a insertar esos lotes.
- El diario persiste cada intento en `ingest_items`, con resultado y mutación. La migración nueva es `apps/api/migrations/0003_ingest_journal.sql`. No está aplicada en remoto.
- El manifiesto de contenido es común. El de cada perfil va en `corpus/<preparación>/profiles/<perfil>/`.
- La métrica que puede marcar un perfil como listo sale de `wrangler vectorize get --json`. Si la respuesta no trae métrica, no se escribe `cosine`. El `describe()` del binding sigue sin traerla.
- Wrangler 4.147.0 no tiene `ai run`. La sonda no se lanza con otro subcomando ni arrancando un Worker.

## Corpus

Los identificadores no cambiaron en esta fase:

| Capa                  | Estado                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| Preparación           | `c3a59a406888b`                                                        |
| Contenido             | `cc037ef0bb1f7`                                                        |
| Perfil lexical        | `p9e8e8e03627e`, `fixture-token-hash-v1`, 128 dimensiones, umbral 0,33 |
| Temario y calendarios | completos                                                              |
| Ejercicios            | parciales: 12 resúmenes y 8 títulos                                    |
| Remoto                | no verificado                                                          |

## Comandos locales

```sh
bun install --frozen-lockfile
bun run check
bun run test
bun run build
bun run preflight
bun run preflight -- --capability sin-rag
bun run preflight -- --capability rag
bun run preflight -- --capability crag
bun run ingest-plan
bun run activate
bun run activate -- provision --execute
bun run activate -- probe-embeddings --execute
```

- Instalación congelada: 183 instalaciones, 335 paquetes, sin cambios.
- `check`: formato, lint y tipos sin avisos en 57 archivos TypeScript, después de formatear el plan.
- `test`: 49 pruebas en 9 archivos, todas en verde. No abren la red.
- `build`: Worker `dist/thepower_rag/index.js` de 2.977,70 kB. No es un despliegue.
- Preflight demo, sin RAG y RAG: código 0. CRAG pedido: código 2.
- `ingest-plan` y `activate`: código 0, sin red.
- `provision --execute`: código 2, falta `maxSpendUsd`. No llegó a Wrangler.
- `probe-embeddings --execute`: código 2, faltan `maxSpendUsd` y `allowWorkersAi`.

La interfaz no cambió. No hubo pase de navegador en esta fase.

## Lectura de la cuenta

`bun run activate -- status --read` salió con código 0. Wrangler 4.147.0 del proyecto, con la cuenta fijada en el entorno y en un config temporal:

- Correo: joseantonionuevo@gmail.com.
- La sesión ve 3 cuentas. La comprobación usó el id `9c1493e94ba21f2c6872a9dd17ba19f7` y el nombre `Joseantonionuevo@gmail.com's Account`. No se eligió la primera.
- D1 `thepower-ai-course-rag-d1`: ausente.
- R2 `thepower-ai-course-rag-corpus`: ausente.
- Vectorize con el prefijo `thepower-ai-course-rag-`: ausente.

Esa lectura no crea recursos. No hubo sonda de embeddings, ingesta, migraciones ni selección de perfil activo. No hay recibo de mutación ni dimensión observada.

## Lo que sigue fuera

- `maxSpendUsd`, `MODEL_ID` y los permisos de alta, Workers AI y OpenRouter.
- La sonda de `@cf/baai/bge-m3`. Además del permiso y del tope, hace falta una ruta que Wrangler 4.147.0 sí tenga: un Worker local con el binding `AI` remoto. No se arrancó. `remoteBindings` sigue en false.
- Umbral semántico, cuatro llamadas dirigidas y CRAG.
- Despliegue público.

`CLAUDE.md` sigue siendo un enlace relativo a `AGENTS.md`. No hubo commit ni push. OpenViking respondió en el túnel, pero este directorio no tiene cuenta mapeada. No se escribió memoria.
