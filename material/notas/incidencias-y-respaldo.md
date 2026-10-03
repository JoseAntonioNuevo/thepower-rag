# Incidencias y respaldo

La vía de la clase es la demo offline. El alta remota es una checklist de profesor, no un plan B en directo.

## La página no abre

1. Mira la terminal de `bun run dev` y abre la URL exacta que imprime, en la línea `Local:`.
2. En el ensayo del 3 de octubre esa línea fue `http://localhost:5173/`. Si este arranque imprime otra, usa esa. No afirmes que `127.0.0.1` es imposible para la aplicación de clase: el puente de `activate` es otro proceso y no se arranca aquí.
3. Si el puerto está ocupado, cierra el proceso anterior de esta demo. No cambies el puerto en caliente si las capturas citan 5173 y el servidor sigue anunciando ese puerto.
4. Si sigue caído, di: «Uso la captura del 3 de octubre de 2026, modo demo, perfil fixture `p9e8e8e03627e`.» Abre el PNG del bloque y vuelve a la diapositiva.

Esas imágenes no son el estado del servicio el día de la clase. Dilo.

## La línea de estado no dice demo

Para. No sigas con la pregunta y no lances `activate`, `status --read` ni `--execute`. Una línea `real` puede intentar llamar a un proveedor. No es el recorrido de esta clase.

`bun run preflight` dice de dónde sale el modo. Lee solo estas líneas. No imprimen secretos:

- `fuente efectiva del Worker:`
- `archivo .dev.vars usado:`
- `APP_MODE efectivo:`
- `process.env no se mezcla con los bindings del Worker`

El Worker usa `apps/web/wrangler.jsonc` y, si existe, `apps/web/.dev.vars`. dotenv 16.3.1 sustituye las claves repetidas. El entorno del proceso no entra. Cerrar el servidor y volver a ejecutar `bun run dev` sin variables exportadas no quita un `APP_MODE=real` escrito en `.dev.vars`.

En este árbol, el 3 de octubre de 2026, preflight dijo `fuente efectiva del Worker: apps/web/wrangler.jsonc`, `archivo .dev.vars usado: ninguno` y `APP_MODE efectivo: demo`. La clase no pasa `--env`.

Para volver a demo, sin mostrar el archivo, sin borrar otras claves y sin tocar la nube:

1. Ctrl-C en la terminal del servidor. No despliegues y no borres `.dev.vars`.
2. Si `APP_MODE efectivo` ya es `demo`, no edites configuración. Arranca otra vez y abre la URL impresa.
3. Si la fuente es solo `apps/web/wrangler.jsonc` y el modo no es `demo`, deja únicamente `vars.APP_MODE` en `demo` dentro de ese archivo. El archivo de clase no guarda secretos.
4. Si la fuente incluye `.dev.vars` (o el `.dev.vars.<entorno>` que preflight nombre) y el modo no es `demo`, cambia solo la asignación `APP_MODE`. No hagas `cat` del archivo. Desde la raíz del repo, con la ruta que preflight indicó:

```bash
python3 - << 'PY'
from pathlib import Path
path = Path("apps/web/.dev.vars")
text = path.read_text()
out = []
changed = False
for line in text.splitlines(keepends=True):
    body = line.lstrip()
    probe = body[7:].lstrip() if body.startswith("export ") else body
    key = probe.split("=", 1)[0].strip() if "=" in probe else ""
    if body.startswith("#") or key != "APP_MODE":
        out.append(line)
        continue
    if line.endswith("\r\n"):
        out.append("APP_MODE=demo\r\n")
    else:
        out.append("APP_MODE=demo\n")
    changed = True
if not changed:
    if out and not out[-1].endswith(("\n", "\r\n")):
        out[-1] += "\n"
    out.append("APP_MODE=demo\n")
path.write_text("".join(out))
print("APP_MODE quedó en demo. No se han mostrado ni borrado otras claves.")
PY
```

Si preflight nombró otro archivo, cambia solo esa ruta en el script. No abras el archivo en el proyector.

5. `bun run preflight` otra vez. Tiene que decir `APP_MODE efectivo: demo`, sin RAG `offline-demo`, RAG y CRAG `offline-fixture`.
6. `bun run dev` y abre la URL de la línea `Local:`. La línea de estado debe decir `demo (fixture)`.

## La respuesta no coincide con el guion

1. Mira la etapa y la audiencia. Cambiar cualquiera vacía la conversación.
2. En CRAG, mira el desplegable. Si el texto de la pregunta se editó, el guion se suelta y pasa a índice lexical.
3. Pulsa **Nueva conversación** y elige el guion otra vez antes de enviar.
4. Si aún no coincide, usa la captura y sigue. No reindexes ni cambies el umbral 0,33 durante la clase.

## Quieres enseñar el fallo de arranque del puente

No lo hagas en clase con `--execute`. El ensayo técnico ya vio que `bun run activate` y `bun run activate -- plan` salen a 0 y dicen `simulación, sin red`. `bun run ingest-plan` imprime ese mismo plan y no embebe nada.

`status --read` consultaría la cuenta. Déjalo fuera.

## Checklist remota, para otro día y con autorización explícita

No está hecha. No la presentes como hecha.

Siguen faltando, y un tope de gasto no los sustituye:

- `maxSpendUsd`
- `MODEL_ID` y permiso de OpenRouter
- permiso de Workers AI
- permiso para crear solo `thepower-ai-course-rag-d1`, `thepower-ai-course-rag-corpus` y el índice `thepower-ai-course-rag-<perfil observado>`
- `allowPlanChange` en false
- un umbral semántico calibrado para el perfil elegido. No valen 0,33 ni 0,55
- la inyección del secreto de OpenRouter en las variables efímeras del Worker de verificación. El proceso no lo reenvía solo
- la dimensión observada de `@cf/baai/bge-m3`

La revisión del 3 de octubre está en `docs/review/phase-7-review.txt`.

## Documento sintético

`corpus/fixtures/fragmento-sintetico.json` se puede abrir. No se añade al corpus preparado ni a `corpus/sources`.
