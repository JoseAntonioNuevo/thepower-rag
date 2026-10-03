# Laboratorio offline S10 y S11

Este archivo es el léeme del archivo de código. No sustituye al `README.md` del proyecto. El alta remota del curso es solo del profesor y no hace falta para este laboratorio.

## Qué podéis ejecutar

Con el lockfile congelado y el modo demo por defecto:

```bash
bun install --frozen-lockfile
bun run preflight
bun run dev
```

`bun run preflight` tiene que decir `APP_MODE efectivo: demo`, `fuente efectiva del Worker: apps/web/wrangler.jsonc` y `archivo .dev.vars usado: ninguno`, salvo que hayáis creado el vuestro. Sin RAG queda `offline-demo`. RAG y CRAG quedan `offline-fixture`. `verificado remotamente: no`.

Después abrid la URL de la línea `Local:` que imprime `bun run dev`. En el ensayo del profesor, el 3 de octubre de 2026, fue `http://localhost:5173/`. Usad la de este arranque.

`GET /api/health` en esa misma origen responde `execution` `demo`. La línea de estado dice `demo (fixture)` y corpus `c3a59a406888b`. **Detalle del corpus** incluye el embedding `fixture-token-hash-v1`.

Eso demuestra el control de la demo: transporte sin documentos, una búsqueda con cita o rechazo, y el grafo con guiones. No demuestra un modelo, ni BGE-M3, ni Vectorize. El umbral 0,33 y las 128 dimensiones son de este índice lexical. No los copiéis como medición semántica.

## Qué no hay que hacer

- No uséis la cuenta de Cloudflare del profesor ni sus claves. Si el código o `AGENTS.md` nombran una cuenta, es el destino del instructor. No es una credencial vuestra y no autoriza gasto.
- No creéis `apps/web/.dev.vars` con secretos ajenos. No hace falta para la demo. Si lo creáis, `.dev.vars` pisa `wrangler.jsonc`. Un reinicio sin variables de proceso no lo deshace. `bun run preflight` dice la fuente efectiva.
- No ejecutes `bun run activate --execute`, `status --read` ni un despliegue. `bun run activate` y `bun run activate -- plan`, sin esas banderas, solo simulan y no llaman a la red.
- No pongáis `APP_MODE=real` para «probar el laboratorio». Sin generación configurada, preflight sale con código 2 y la demo de clase deja de ser la de fixtures.
- El conjunto reservado de veinte preguntas del profesor no está en este archivo. No forma parte del laboratorio.
- Este archivo no incluye `docs/activation.example.json` ni `docs/wrangler.cloud.example.jsonc`: son plantillas del profesor con su cuenta. No las reconstruyas para el laboratorio.

## Comandos que sí son locales

`bun run check` y `bun run build` no llaman a un modelo ni a una cuenta. `bun run ingest-plan` imprime el plan y no embebe.

Hace falta Bun 1.4.2, el que declara `packageManager`. El perfil de `apps/web/wrangler.jsonc` ya viene en `demo`, sin bindings y sin `account_id`.
