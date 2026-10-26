# Incidencias y respaldo en directo

El diseño de la clase cuenta con tres capas independientes para que ninguna incidencia detenga la explicación:

1. **Demostrador web en vivo (`https://rag-thepower.josenuevo.dev` o `bun run dev:real`).**
2. **Laboratorio reproducible local (`bun run lab:demo` y `bun run lab:eval`, deterministas sobre ThePower Shop), recibos reales de ThePower Shop (`docs/evidence/thepower-shop-2026-10-24/`) y demostrador local (`bun run dev` con `APP_MODE=demo`).**
3. **Capturas fechadas (`material/evidencias/capturas/`) y PDFs de respaldo (`material/presentaciones/*.pdf`).**

---

## 1. El servidor local no está en modo `demo` al arrancar `bun run dev`

El Worker local lee `apps/web/wrangler.jsonc` y, si existe, `apps/web/.dev.vars`. `process.env` no se mezcla con los bindings del Worker, por lo que reiniciar la terminal sin variables exportadas **no deshace** un `APP_MODE=real` escrito en `.dev.vars`.

1. Ejecuta `bun run preflight` y lee únicamente:
   - `fuente efectiva del Worker:`
   - `archivo .dev.vars usado:`
   - `APP_MODE efectivo:`
2. Si `archivo .dev.vars usado` indica `apps/web/.dev.vars` y `APP_MODE efectivo` es `real`, cámbialo a `demo` sin imprimir el archivo en pantalla ni borrar otras claves:

```bash
python3 - << 'PY'
from pathlib import Path
path = Path("apps/web/.dev.vars")
if path.exists():
    lines = path.read_text().splitlines(keepends=True)
    out = []
    changed = False
    for line in lines:
        body = line.lstrip()
        probe = body[7:].lstrip() if body.startswith("export ") else body
        key = probe.split("=", 1)[0].strip() if "=" in probe else ""
        if body.startswith("#") or key != "APP_MODE":
            out.append(line)
            continue
        out.append("APP_MODE=demo\r\n" if line.endswith("\r\n") else "APP_MODE=demo\n")
        changed = True
    if not changed:
        if out and not out[-1].endswith(("\n", "\r\n")):
            out[-1] += "\n"
        out.append("APP_MODE=demo\n")
    path.write_text("".join(out))
print("APP_MODE ajustado a demo sin mostrar ni borrar otras claves.")
PY
```

3. Comprueba de nuevo `bun run preflight` (`APP_MODE efectivo: demo`) y arranca `bun run dev`.

---

## 2. Docker no está arrancado al enseñar el laboratorio `pgvector` (`lab/`)

- No pierdas tiempo de clase iniciando Docker Desktop si está apagado.
- Enseña el esquema real en `lab/schema.sql` (`CREATE EXTENSION IF NOT EXISTS vector`, `embedding vector(768) NOT NULL`, `USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`) y ejecuta:
  ```bash
  bun run lab:rebuild
  bun run lab:demo
  bun run lab:eval
  ```
- Explica que sin la bandera `--postgres` el CLI ejecuta `InMemoryPgVectorStore`, que valida exactamente las `768` dimensiones y calcula la misma distancia coseno `<=>` (`1 - similitud`), y que en casa con Docker activo pueden pasar `--postgres` contra el contenedor de `lab/docker-compose.yml`.

---

## 3. El dominio público pide desafío interactivo de Turnstile o agota cuota

- Si Turnstile muestra el widget interactivo, resuélvelo o explica en 1 minuto por qué existe (`material/notas/proteger-un-chat-publico.md`: 6 peticiones/60 s por sesión y 120/60 s por IP para proteger el presupuesto público D1).
- Si deseas continuar sin esperas de red, pasa inmediatamente a `bun run dev` (`http://localhost:5173/`) y a `bun run lab:demo`. Para la comparación real de S11, abre los recibos de `docs/evidence/thepower-shop-2026-10-24/` y di que son del ensayo del 24 de octubre. Nunca desactives la protección del Worker de producción ni ejecutes `wrangler deploy` durante la clase.
