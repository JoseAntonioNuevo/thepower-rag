# thepower-rag

Asistente de curso en español para AI Engineer. La fase 7 conecta el CLI con el Worker del puente. La fase 6 dejó el plazo, la ordenación y el presupuesto de sesión. El corpus de alumno cubre S1 a S20. La demo recorre el grafo con guiones. Desde el 3 de octubre de 2026 está desplegado y verificado en `rag-thepower.josenuevo.dev`; el estado y los límites están en `docs/despliegue-real.md`.

Las clases previstas son S10 (22 de octubre de 2026, sin RAG y RAG básico) y S11 (27 de octubre de 2026, CRAG sobre la misma aplicación).

## Aislamiento

Editar solo este directorio. `1-langGraph`, `2-modelos` y `kanban` son proyectos independientes. No copiar sus invariantes, cuentas ni archivos de entorno. La guía del directorio padre es una fuente parcial de solo lectura.

El usuario autorizó el 3 de octubre de 2026 montar y desplegar este proyecto en `rag-thepower.josenuevo.dev`, con hasta 5 USD para puesta en marcha. La ejecución quedó documentada en `docs/despliegue-real.md`. No ampliar recursos, dominios, presupuesto, planes ni suscripciones sin nueva autorización. Un build local no es un despliegue. `APP_MODE=real`, un login de Wrangler o un archivo generado por el agente no autorizan un alta ni un gasto. La cuenta de destino, leída en whoami, es la de joseantonionuevo@gmail.com, nombre `Joseantonionuevo@gmail.com's Account`, id `9c1493e94ba21f2c6872a9dd17ba19f7`. Esa identidad no incluye tope de gasto, `MODEL_ID` ni permiso para crear recursos o cambiar de plan.

`bun run activate` y `bun run activate -- plan` no llaman a la red. `bun run activate -- status --read` solo lee esa cuenta y los tres nombres del curso. `--execute` llama a Wrangler únicamente si `apps/web/.activation.json` trae el permiso de esa operación y un tope que cubre el coste estimado. No se cambia el perfil global de autenticación ni se lee el llavero.

## Runtime

- Bun 1.4.2 instala dependencias y ejecuta `scripts/`.
- Vite+ 1.0.0 ejecuta desarrollo, formato, lint, tipos y pruebas con Node.
- El Worker corre en workerd. `apps/api` no usa APIs exclusivas de Bun ni el disco como almacén.
- Sin `--env`, la configuración local sale de `apps/web/wrangler.jsonc` y, si existe, `apps/web/.dev.vars`. Con `--env`, las `vars` y los bindings no se heredan del nivel superior. Si existe `.dev.vars.<entorno>`, solo se carga ese archivo. No se mezcla `process.env`.
- `demo` no necesita secretos. `real` para sin RAG necesita `OPENROUTER_API_KEY` y `MODEL_ID`. RAG real necesita además embeddings, dimensión observada, versión, perfil, métrica `cosine`, umbral y los bindings `AI`, `VECTORIZE`, `DB` y `CORPUS` configurados. El perfil tiene que estar `ready` y coincidir. `EVALUATOR_MODEL_ID` no bloquea esas dos etapas. CRAG real lo añade y, si falta, no vuelve a RAG básico.

## Versiones

Las dependencias directas van fijadas. `vite` se resuelve a `@voidzero-dev/vite-plus-core@1.0.0` y `vitest` queda en `5.0.1`. `dotenv` 16.3.1 iguala el parser de Wrangler. No añadir ESLint, Prettier, Turborepo, Nx, TanStack AI, PostgreSQL ni un segundo Vitest.

## Comandos

Desde este directorio:

```sh
bun install --frozen-lockfile
bun run prepare-corpus
bun run dev
bun run check
bun run test
bun run build
bun run preflight
bun run preflight -- --capability rag
bun run ingest-plan
bun run activate
bun run activate -- status --read
bun run test:entrypoint
```

`bun run preview` sirve el build en local y tampoco despliega. La evidencia de las fases anteriores se conserva. La de esta fase está en `docs/phase-7-verification.md`. El plan de recursos está en `docs/cloud-activation-plan.md`.

`scripts/activate.ts` arranca el puente solo para `probe-embeddings`, `ingest`, `resume`, `select-active` y `verify` con `--execute` y la autorización de esa operación. `plan` y `status --read` no lo arrancan. Sin autorización, `--execute` sale con código 2 y no abre el puerto. `resume()` sin plano sigue siendo la lectura administrativa. `select-active` exige la lectura final en D1 y no borra perfiles anteriores. Un listado Vectorize o de metadatos que no traiga el sobre esperado es lectura no confirmada y no crea nada. `bun run test:entrypoint` recorre el CLI contra workerd en `127.0.0.1` con recursos emulados y sin red externa.
